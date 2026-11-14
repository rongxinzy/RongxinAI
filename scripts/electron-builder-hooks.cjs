'use strict';

const path = require('path');
const { existsSync, readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } = require('fs');
const { spawnSync } = require('child_process');
const {
  resolveWindows7zaPath,
  packWindowsResourceComponent7z,
} = require('./packaging/windows-component-archive.cjs');
const { writeNsisOfflineComponentRouting } = require('./resolve-nsis-offline-components.cjs');
const { ensurePortablePythonRuntime, checkRuntimeHealth } = require('./setup-python-runtime.js');
const { configureMagpieResources } = require('./magpie-runtime.cjs');
const {
  verifyPackagedDeliverables,
  resolveTargetArch,
} = require('./packaging/verify-packaged-runtimes.cjs');
const {
  ensurePortableUvRuntime,
  checkRuntimeHealth: checkUvRuntimeHealth,
} = require('./setup-uv-runtime.js');
const {
  ensurePosixUvRuntime,
  checkRuntimeHealth: checkMacUvRuntimeHealth,
} = require('./setup-mac-uv-runtime.js');
const {
  ensurePosixPythonRuntime,
  checkRuntimeHealth: checkMacPythonRuntimeHealth,
} = require('./setup-mac-python-runtime.js');
const {
  ensureSkillPythonRuntimes,
  checkSkillPythonRuntimeHealth,
} = require('./setup-skill-python-runtime.js');
const {
  applyPackagingExcludes,
  assertPackagedApp,
  pinElectronLanguages,
} = require('./packaging/assert-package-contents.cjs');
const { assertModelCatalog } = require('./packaging/assert-model-catalog.cjs');

const {
  buildWindowsResourceBundleManifest,
  buildWindowsResourceComponentManifest,
  computeWindowsResourceComponentId,
  getWindowsResourceArchiveCompression,
  getWindowsResourceComponents,
  isWindowsResourceComponentReusable,
  sha256File,
} = require('./windows-resource-pack.cjs');

function isWindowsTarget(context) {
  return context?.electronPlatformName === 'win32';
}

function isMacTarget(context) {
  return context?.electronPlatformName === 'darwin';
}

function isLinuxTarget(context) {
  return context?.electronPlatformName === 'linux';
}

function configureMacAutoUpdateMetadata(context, env = process.env) {
  if (!isMacTarget(context)) {
    return;
  }

  const enabled = env.ZHIYUAN_MAC_AUTO_UPDATE_ENABLED === 'true';
  context.packager.config.extraMetadata = {
    ...(context.packager.config.extraMetadata || {}),
    zhiyuanMacAutoUpdateEnabled: enabled,
  };
  console.log(
    `[electron-builder-hooks] macOS in-app automatic installation: ${enabled ? 'enabled' : 'disabled (manual DMG fallback)'}`,
  );
}

function applyMacIconFix(appPath) {
  console.log('[electron-builder-hooks] Applying macOS Launchpad icon fix...');

  const infoPlistPath = path.join(appPath, 'Contents', 'Info.plist');
  const resourcesPath = path.join(appPath, 'Contents', 'Resources');
  const iconPath = path.join(resourcesPath, 'icon.icns');

  if (!existsSync(infoPlistPath)) {
    console.warn(`[electron-builder-hooks] Info.plist not found at ${infoPlistPath}`);
    return;
  }

  if (!existsSync(iconPath)) {
    console.warn(`[electron-builder-hooks] icon.icns not found at ${iconPath}`);
    return;
  }

  // CFBundleIconName is only valid with an Assets.car icon. This app ships
  // icon.icns, so leaving the key set makes Launchpad ignore that file and
  // show the Electron default icon.
  const iconName = spawnSync('plutil', ['-extract', 'CFBundleIconName', 'raw', infoPlistPath], {
    encoding: 'utf-8',
  });
  if (iconName.status === 0) {
    const removeResult = spawnSync('plutil', ['-remove', 'CFBundleIconName', infoPlistPath], {
      encoding: 'utf-8',
    });
    if (removeResult.status !== 0) {
      console.warn(
        '[electron-builder-hooks] Failed to remove CFBundleIconName:',
        removeResult.stderr,
      );
    }
  }

  const iconFile = spawnSync('plutil', ['-extract', 'CFBundleIconFile', 'raw', infoPlistPath], {
    encoding: 'utf-8',
  });
  const iconFileName = iconFile.status === 0 ? iconFile.stdout.trim() : '';
  if (iconFileName !== 'icon.icns') {
    const args =
      iconFile.status === 0
        ? ['-replace', 'CFBundleIconFile', '-string', 'icon.icns', infoPlistPath]
        : ['-insert', 'CFBundleIconFile', '-string', 'icon.icns', infoPlistPath];
    const fileResult = spawnSync('plutil', args, { encoding: 'utf-8' });
    if (fileResult.status !== 0) {
      console.warn('[electron-builder-hooks] Failed to set CFBundleIconFile:', fileResult.stderr);
    }
  }

  spawnSync('xattr', ['-cr', appPath], { encoding: 'utf-8' });
  spawnSync('touch', [appPath], { encoding: 'utf-8' });
  spawnSync('touch', [resourcesPath], { encoding: 'utf-8' });
  spawnSync('touch', [iconPath], { encoding: 'utf-8' });

  console.log('[electron-builder-hooks] macOS Launchpad icon fix applied');
}

/**
 * Check if a command exists in the system PATH.
 */
function hasCommand(command) {
  const checker = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(checker, [command], { stdio: 'ignore' });
  return result.status === 0;
}

/**
 * Install dependencies for all skills in the SKILLs directory.
 * This ensures bundled skills include node_modules for users without npm.
 */
function installSkillDependencies() {
  // Check if npm is available (should be available during build)
  if (!hasCommand('npm')) {
    console.warn(
      '[electron-builder-hooks] npm not found in PATH, skipping skill dependency installation',
    );
    console.warn(
      '[electron-builder-hooks]   (This is only a warning - skills will be installed at runtime if needed)',
    );
    return;
  }

  const skillsDir = path.join(__dirname, '..', 'SKILLs');
  if (!existsSync(skillsDir)) {
    console.log(
      '[electron-builder-hooks] SKILLs directory not found, skipping skill dependency installation',
    );
    return;
  }

  console.log('[electron-builder-hooks] Installing skill dependencies...');

  const entries = readdirSync(skillsDir);
  let installedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const entry of entries) {
    const skillPath = path.join(skillsDir, entry);
    const stat = statSync(skillPath);
    if (!stat.isDirectory()) continue;

    const packageJsonPath = path.join(skillPath, 'package.json');
    const nodeModulesPath = path.join(skillPath, 'node_modules');

    if (!existsSync(packageJsonPath)) {
      continue; // No package.json, skip
    }

    if (existsSync(nodeModulesPath)) {
      console.log(`[electron-builder-hooks]   ${entry}: node_modules exists, skipping`);
      skippedCount++;
      continue;
    }

    console.log(`[electron-builder-hooks]   ${entry}: installing dependencies...`);
    // On Windows, use shell: true so cmd.exe resolves npm.cmd correctly
    const isWin = process.platform === 'win32';
    const result = spawnSync('npm', ['install'], {
      cwd: skillPath,
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 5 * 60 * 1000, // 5 minute timeout
      shell: isWin,
    });

    if (result.status === 0) {
      console.log(`[electron-builder-hooks]   ${entry}: ✓ installed`);
      installedCount++;
    } else {
      console.error(`[electron-builder-hooks]   ${entry}: ✗ failed`);
      if (result.error) {
        console.error(`[electron-builder-hooks]     Error: ${result.error.message}`);
      }
      if (result.stderr) {
        console.error(`[electron-builder-hooks]     ${result.stderr.substring(0, 200)}`);
      }
      failedCount++;
    }
  }

  console.log(
    `[electron-builder-hooks] Skill dependencies: ${installedCount} installed, ${skippedCount} skipped, ${failedCount} failed`,
  );
}

function configureInferenceEditionPublishUrls(context) {
  const edition = (process.env.ZHIYUAN_UPDATE_VARIANT || 'lite').trim().toLowerCase();
  const arch = resolveTargetArch(context);
  const platformName = context?.electronPlatformName;
  if (!platformName) return;

  if (process.env.ZHIYUAN_DISTRIBUTION === 'kylin-v11') {
    for (const section of [
      context.packager.config,
      context.packager.config.mac,
      context.packager.config.win,
      context.packager.config.linux,
    ]) {
      if (section && typeof section === 'object') section.publish = [];
    }
    console.log('[electron-builder-hooks] Kylin V11 package: auto-update metadata disabled.');
    return;
  }

  /** @type {string | undefined} */
  let publishUrl;
  if (platformName === 'darwin') {
    publishUrl = `https://updates.rongxzyai.com/v2/electron/stable/darwin/${arch}/${edition}`;
  } else if (platformName === 'win32') {
    publishUrl = `https://updates.rongxzyai.com/v2/electron/stable/win32/x64/${edition}`;
  } else if (platformName === 'linux') {
    publishUrl = `https://updates.rongxzyai.com/v2/electron/stable/linux/x64/appimage-${edition}`;
  }
  if (!publishUrl) return;

  const applyPublishUrl = section => {
    if (!section || typeof section !== 'object') return;
    section.publish = [{ provider: 'generic', url: publishUrl }];
  };
  applyPublishUrl(context.packager.config);
  applyPublishUrl(context.packager.config.mac);
  applyPublishUrl(context.packager.config.win);
  applyPublishUrl(context.packager.config.linux);
  console.log(`[electron-builder-hooks] inference edition ${edition}: publish url ${publishUrl}`);
}

function configureInferenceEditionResources(context) {
  const edition = (process.env.ZHIYUAN_UPDATE_VARIANT || 'lite').trim().toLowerCase();
  const extraResources = Array.isArray(context.packager.config.extraResources)
    ? [...context.packager.config.extraResources]
    : [];

  const withoutLegacyBackends = extraResources.filter(entry => {
    const target = typeof entry === 'string' ? entry : entry?.to;
    return target !== 'llamacpp-backends';
  });

  const withoutBundled = withoutLegacyBackends.filter(entry => {
    const target = typeof entry === 'string' ? entry : entry?.to;
    return target !== 'llamacpp-bundled' && target !== 'strata-bundled';
  });

  if (edition === 'lite') {
    context.packager.config.extraResources = withoutBundled;
    console.log('[electron-builder-hooks] lite edition: omit bundled llama.cpp runtime.');
    return;
  }

  const prepare = spawnSync(process.execPath, ['scripts/prepare-inference-edition-runtime.cjs'], {
    cwd: path.join(__dirname, '..'),
    env: process.env,
    stdio: 'inherit',
  });
  if (prepare.status !== 0) {
    throw new Error(
      `[electron-builder-hooks] Failed to stage bundled llama.cpp runtime for edition ${edition}.`,
    );
  }

  if (edition === 'cuda' && context.electronPlatformName === 'win32') {
    const prepareStrata = spawnSync(process.execPath, ['scripts/prepare-strata-runtime.cjs'], {
      cwd: path.join(__dirname, '..'),
      env: process.env,
      stdio: 'inherit',
    });
    if (prepareStrata.status !== 0) {
      throw new Error(
        `[electron-builder-hooks] Failed to stage bundled Strata runtime for edition ${edition}.`,
      );
    }
  }

  const windowsComponentBundled =
    context.electronPlatformName === 'win32' && (edition === 'cpu' || edition === 'cuda');
  if (windowsComponentBundled) {
    context.packager.config.extraResources = withoutBundled;
    console.log(
      `[electron-builder-hooks] inference edition ${edition}: llama.cpp runtime packed as Windows offline component.`,
    );
    return;
  }

  const hasBundled = withoutLegacyBackends.some(entry => {
    const target = typeof entry === 'string' ? entry : entry?.to;
    return target === 'llamacpp-bundled';
  });
  context.packager.config.extraResources = hasBundled
    ? withoutLegacyBackends
    : [
        ...withoutLegacyBackends,
        {
          from: 'resources/llamacpp-bundled',
          to: 'llamacpp-bundled',
          filter: ['**/*'],
        },
      ];
  console.log(
    `[electron-builder-hooks] inference edition ${edition}: bundled llama.cpp runtime enabled.`,
  );
}

async function beforePack(context) {
  assertModelCatalog(path.join(__dirname, '..', 'resources', 'model-catalog.sqlite'));
  configureMagpieResources(context);
  configureMacAutoUpdateMetadata(context);
  configureInferenceEditionPublishUrls(context);
  configureInferenceEditionResources(context);
  // Install skill dependencies first (for all platforms)
  installSkillDependencies();

  if (isWindowsTarget(context)) {
    console.log(
      '[electron-builder-hooks] Windows target detected, ensuring portable uv runtime is prepared...',
    );
    await ensurePortableUvRuntime({ required: true });
    const uvRuntimeRoot = path.join(__dirname, '..', 'resources', 'uv-win');
    const uvRuntimeHealth = checkUvRuntimeHealth(uvRuntimeRoot);
    if (!uvRuntimeHealth.ok) {
      throw new Error(
        'Portable uv runtime health check failed before pack. Missing files: ' +
          uvRuntimeHealth.missing.join(', '),
      );
    }

    console.log(
      '[electron-builder-hooks] Windows target detected, ensuring uv-managed Python 3.14.6 runtime is prepared...',
    );
    await ensurePortablePythonRuntime({ required: true });
    const pythonRuntimeRoot = path.join(__dirname, '..', 'resources', 'python-win');
    const pythonRuntimeHealth = checkRuntimeHealth(pythonRuntimeRoot, {
      requirePip: true,
    });
    if (!pythonRuntimeHealth.ok) {
      throw new Error(
        'Portable Python runtime health check failed before pack. Missing files: ' +
          pythonRuntimeHealth.missing.join(', '),
      );
    }
  }

  if (isMacTarget(context) || isLinuxTarget(context)) {
    const targetArch = resolveTargetArch(context);
    const targetPlatform = context.electronPlatformName;
    const resourceSuffix = targetPlatform === 'darwin' ? 'mac' : 'linux';
    console.log(
      `[electron-builder-hooks] ${targetPlatform} target detected, ensuring bundled uv and uv-managed Python 3.14.6...`,
    );
    await ensurePosixUvRuntime({
      required: true,
      platform: targetPlatform,
      arch: targetArch,
    });
    const uvHealth = checkMacUvRuntimeHealth(
      path.join(__dirname, '..', 'resources', `uv-${resourceSuffix}`),
      targetArch,
      targetPlatform,
    );
    if (!uvHealth.ok)
      throw new Error(
        `Bundled ${targetPlatform} uv health check failed: ${uvHealth.missing.join(', ')}`,
      );
    await ensurePosixPythonRuntime({
      required: true,
      platform: targetPlatform,
      arch: targetArch,
    });
    const pythonHealth = checkMacPythonRuntimeHealth(
      path.join(__dirname, '..', 'resources', `python-${resourceSuffix}`),
      targetArch,
      targetPlatform,
    );
    if (!pythonHealth.ok)
      throw new Error(
        `Bundled ${targetPlatform} Python health check failed: ${pythonHealth.missing.join(', ')}`,
      );
  }

  if (isWindowsTarget(context) || isMacTarget(context) || isLinuxTarget(context)) {
    const targetPlatform = context.electronPlatformName;
    const targetArch = resolveTargetArch(context);
    console.log(
      `[electron-builder-hooks] Preparing bundled Python environments for Skills (${targetPlatform}-${targetArch})...`,
    );
    const skillPythonResult = await ensureSkillPythonRuntimes({
      platform: targetPlatform,
      arch: targetArch,
      required: true,
    });
    console.log(
      `[electron-builder-hooks] Bundled Python environments ready: ${skillPythonResult.environments.length}`,
    );
  }

  if (isWindowsTarget(context)) {
    // The installer remains fully offline, while each non-llama.cpp component
    // gets an independent content ID so upgrades expand only changed pieces.
    const projectRoot = path.join(__dirname, '..');
    const componentsDir = path.join(projectRoot, 'build-tar', 'windows-components');
    mkdirSync(componentsDir, { recursive: true });
    const sevenZipPath = resolveWindows7zaPath();
    const sevenZipSha256 = sha256File(sevenZipPath);
    writeFileSync(path.join(componentsDir, '7za.sha256'), sevenZipSha256, 'utf8');
    const componentManifests = [];

    for (const component of getWindowsResourceComponents(projectRoot)) {
      const archivePath = path.join(componentsDir, `${component.key}.7z`);
      const manifestPath = path.join(componentsDir, `${component.key}.manifest.json`);
      const versionPath = path.join(componentsDir, `${component.key}.version`);
      const hashPath = path.join(componentsDir, `${component.key}.sha256`);
      const sentinelHashPath = path.join(componentsDir, `${component.key}.sentinel-sha256`);
      const contentId = computeWindowsResourceComponentId(component);
      const reusable = isWindowsResourceComponentReusable(
        manifestPath,
        archivePath,
        contentId,
        component,
      );

      if (!reusable) {
        const startedAt = Date.now();
        packWindowsResourceComponent7z(component, archivePath, sevenZipPath);
        console.log(
          `[electron-builder-hooks] Packed ${component.key} ${contentId} with ${
            getWindowsResourceArchiveCompression(component).id
          } in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
        );
      }

      const archiveSha256 = sha256File(archivePath);
      const archiveSizeBytes = statSync(archivePath).size;
      const sentinelPath = path.join(
        component.dir,
        component.sentinel.slice(component.prefix.length + 1),
      );
      const sentinelSha256 = sha256File(sentinelPath);
      const manifest = buildWindowsResourceComponentManifest(
        component,
        contentId,
        archiveSha256,
        archiveSizeBytes,
        sentinelSha256,
      );
      componentManifests.push(manifest);
      writeFileSync(versionPath, contentId, 'utf8');
      writeFileSync(hashPath, archiveSha256, 'utf8');
      writeFileSync(sentinelHashPath, sentinelSha256, 'utf8');
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      console.log(
        `[electron-builder-hooks] ${reusable ? 'Reusing' : 'Prepared'} ${component.key}: ${(
          archiveSizeBytes /
          (1024 * 1024)
        ).toFixed(1)} MB`,
      );
    }

    writeFileSync(
      path.join(componentsDir, 'manifest.json'),
      `${JSON.stringify(buildWindowsResourceBundleManifest(componentManifests), null, 2)}\n`,
      'utf8',
    );
    writeNsisOfflineComponentRouting(componentsDir, componentManifests);
  }

  // Pin after resource checks so a missing runtime still fails with its own
  // error. beforePack returns before Electron copies locales, so this is early
  // enough to stop an empty platform list from shipping every Chromium locale.
  const languages = pinElectronLanguages(context.packager.config);
  console.log(`[electron-builder-hooks] Chromium locales pinned: ${languages.join(', ')}`);

  // Re-apply after hooks append extra resources (Magpie, Windows components) so
  // a token file or source map added to those trees cannot be packed.
  applyPackagingExcludes(context.packager.config);

  if (!isWindowsTarget(context)) {
    return;
  }
}

async function afterPack(context) {
  const resourcesDir = isMacTarget(context)
    ? path.join(
        context.appOutDir,
        `${context.packager.appInfo.productFilename}.app`,
        'Contents',
        'Resources',
      )
    : path.join(context.appOutDir, 'resources');
  assertModelCatalog(path.join(resourcesDir, 'model-catalog.sqlite'));
  verifyPackagedDeliverables(context);
  assertPackagedApp({
    projectRoot: path.join(__dirname, '..'),
    appOutDir: context.appOutDir,
    electronLanguages: context.packager.config.electronLanguages,
  });
  if (isMacTarget(context)) {
    const appName = context.packager.appInfo.productFilename;
    const appPath = path.join(context.appOutDir, `${appName}.app`);

    if (existsSync(appPath)) {
      applyMacIconFix(appPath);
    } else {
      console.warn(`[electron-builder-hooks] App not found at ${appPath}, skipping icon fix`);
    }
  }
}

module.exports = {
  beforePack,
  afterPack,
  configureMacAutoUpdateMetadata,
  packWindowsResourceComponent7z,
};
