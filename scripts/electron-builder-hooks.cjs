'use strict';

const path = require('path');
const os = require('os');
const {
  existsSync,
  cpSync,
  readFileSync,
  statSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  renameSync,
  writeFileSync,
  symlinkSync,
} = require('fs');
const { execFileSync, spawnSync } = require('child_process');
const { writeNsisOfflineComponentRouting } = require('./resolve-nsis-offline-components.cjs');
const { ensurePortablePythonRuntime, checkRuntimeHealth } = require('./setup-python-runtime.js');
const { configureMagpieResources } = require('./magpie-runtime.cjs');
const { verifyPackagedDeliverables } = require('./packaging/verify-packaged-runtimes.cjs');
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
  listWindowsResourceComponentFiles,
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

function resolveTargetArch(context) {
  if (context?.arch === 3) return 'arm64';
  if (context?.arch === 0) return 'ia32';
  if (context?.arch === 1) return 'x64';
  throw new Error(`[electron-builder-hooks] Unknown packaging arch: ${String(context?.arch)}`);
}

function resolveWindows7zaPath() {
  const sevenZipPath = path.join(
    __dirname,
    '..',
    'node_modules',
    '7zip-bin',
    'win',
    'x64',
    '7za.exe',
  );
  if (!existsSync(sevenZipPath)) {
    throw new Error(
      '[electron-builder-hooks] Missing bundled Windows 7za.exe. Run bun install before packaging.',
    );
  }
  return sevenZipPath;
}

function packWindowsResourceComponent7z(
  component,
  archivePath,
  sevenZipPath,
  files = listWindowsResourceComponentFiles(component),
) {
  if (files.length === 0) {
    throw new Error(`[electron-builder-hooks] No files to archive for ${component.key}`);
  }
  const stagingRoot = mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-component-7z-'));
  const stagedPrefix = path.join(stagingRoot, component.prefix);
  const listPath = path.join(stagingRoot, 'files.txt');
  const temporaryArchivePath = `${archivePath}.${process.pid}.packing`;
  try {
    // A junction keeps the archive layout stable without copying a multi-hundred-MB
    // component into a temporary staging directory. List only the files used for its ID.
    symlinkSync(component.dir, stagedPrefix, 'junction');
    writeFileSync(
      listPath,
      files.map(file => path.join(component.prefix, file)).join('\n') + '\n',
      'utf8',
    );
    const compression = getWindowsResourceArchiveCompression(component);
    rmSync(temporaryArchivePath, { force: true });
    const result = spawnSync(
      sevenZipPath,
      [
        'a',
        '-t7z',
        '-spd',
        '-scsUTF-8',
        ...compression.sevenZipArgs,
        temporaryArchivePath,
        `@${listPath}`,
      ],
      {
        cwd: stagingRoot,
        encoding: 'utf8',
      },
    );
    if (result.error || result.status !== 0) {
      throw new Error(
        '[electron-builder-hooks] Failed to create ' +
          component.key +
          ' .7z archive: ' +
          (result.error?.message || result.stderr || result.stdout || `exit ${result.status}`),
      );
    }
    rmSync(archivePath, { force: true });
    renameSync(temporaryArchivePath, archivePath);
  } finally {
    rmSync(temporaryArchivePath, { force: true });
    rmSync(stagingRoot, { recursive: true, force: true });
  }
}

/** Verify that the prepared channel runtime matches the immutable release pin. */
function ensureBundledChannelRuntime(context) {
  const projectRoot = path.join(__dirname, '..');
  const platform = context?.electronPlatformName;
  const arch = resolveTargetArch(context);
  const runtimeBase = path.join(projectRoot, 'vendor', 'channel-runtime');
  const binaryName = platform === 'win32' ? 'cc-connect-sidecar.exe' : 'cc-connect-sidecar';
  const targetId = `${platform === 'win32' ? 'win' : platform === 'darwin' ? 'mac' : platform}-${arch}`;
  const currentDirectory = path.join(runtimeBase, 'current');
  if (process.env.ZHIYUAN_ALLOW_HOST_CHANNEL_RUNTIME === '1') {
    const currentBuildInfoPath = path.join(currentDirectory, 'runtime-build-info.json');
    const currentBuildInfo = existsSync(currentBuildInfoPath)
      ? JSON.parse(readFileSync(currentBuildInfoPath, 'utf8'))
      : null;
    const currentBinary = path.join(
      currentDirectory,
      typeof currentBuildInfo?.binary === 'string' ? currentBuildInfo.binary : binaryName,
    );
    if (
      currentBuildInfo?.sourceRepository &&
      currentBuildInfo?.sourceRevision &&
      currentBuildInfo?.sha256 &&
      existsSync(currentBinary) &&
      sha256File(currentBinary) === currentBuildInfo.sha256
    ) {
      console.log('[electron-builder-hooks] Using the verified host-built channel runtime.');
      return;
    }
  }
  const targetDirectory = path.join(runtimeBase, targetId);
  const binaryPath = path.join(targetDirectory, binaryName);
  const buildInfoPath = path.join(targetDirectory, 'runtime-build-info.json');
  if (!existsSync(binaryPath) || !existsSync(buildInfoPath)) {
    throw new Error(
      '[electron-builder-hooks] Missing verified channel runtime. Run the matching channel:runtime:<target> script before packaging.',
    );
  }
  const packageJson = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  const config = packageJson.channelRuntime;
  const buildInfo = JSON.parse(readFileSync(buildInfoPath, 'utf8'));
  const checksum = config?.runtimeChecksums?.[targetId];
  const assetName = config?.runtimeAssets?.[targetId];
  if (
    buildInfo?.schemaVersion !== 1 ||
    buildInfo?.repo !== config?.repo ||
    buildInfo?.version !== config?.version ||
    buildInfo?.sourceRevision !== config?.sourceRevision ||
    buildInfo?.target !== targetId ||
    buildInfo?.assetName !== assetName ||
    buildInfo?.checksum !== checksum ||
    sha256File(binaryPath) !== checksum
  ) {
    throw new Error(
      '[electron-builder-hooks] Channel runtime does not match the pinned release metadata.',
    );
  }

  const stagedCurrentDirectory = mkdtempSync(path.join(runtimeBase, '.current.packaging-'));
  try {
    rmSync(stagedCurrentDirectory, { recursive: true, force: true });
    cpSync(targetDirectory, stagedCurrentDirectory, { recursive: true });
    rmSync(currentDirectory, { recursive: true, force: true });
    renameSync(stagedCurrentDirectory, currentDirectory);
  } finally {
    rmSync(stagedCurrentDirectory, { recursive: true, force: true });
  }
}

function findPackagedPythonExecutable(appOutDir) {
  const candidates = [
    path.join(appOutDir, 'resources', 'python-win', 'python.exe'),
    path.join(appOutDir, 'resources', 'python-win', 'python3.exe'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
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

function configureInferenceEditionPublishUrls(context, edition) {
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

function configureInferenceEditionResources(context, edition) {
  const extraResources = Array.isArray(context.packager.config.extraResources)
    ? [...context.packager.config.extraResources]
    : [];

  const withoutLegacyBackends = extraResources.filter(entry => {
    const target = typeof entry === 'string' ? entry : entry?.to;
    return target !== 'llamacpp-backends';
  });

  const withoutBundled = withoutLegacyBackends.filter(entry => {
    const target = typeof entry === 'string' ? entry : entry?.to;
    return target !== 'llamacpp-bundled';
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

let bundledSkillsPrepared = false;

async function beforePack(context) {
  const projectRoot = path.join(__dirname, '..');
  const edition = (process.env.ZHIYUAN_UPDATE_VARIANT || 'lite').trim().toLowerCase();
  assertModelCatalog(path.join(projectRoot, 'resources', 'model-catalog.sqlite'));
  configureMagpieResources(context);
  context.packager.config.extraMetadata = {
    ...context.packager.config.extraMetadata,
    zhiyuanUpdateVariant: edition,
  };
  configureMacAutoUpdateMetadata(context);
  configureInferenceEditionPublishUrls(context, edition);
  configureInferenceEditionResources(context, edition);
  ensureBundledChannelRuntime(context);
  if (!bundledSkillsPrepared) {
    execFileSync('bun', ['run', 'build:skills'], {
      cwd: projectRoot,
      stdio: 'inherit',
    });
    bundledSkillsPrepared = true;
  }

  if (isWindowsTarget(context)) {
    execFileSync(process.execPath, [require.resolve('./build-docx-runtime.cjs')], {
      cwd: projectRoot,
      stdio: 'inherit',
    });
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
      const files = listWindowsResourceComponentFiles(component);
      const contentId = computeWindowsResourceComponentId(component, files);
      const reusable = isWindowsResourceComponentReusable(
        manifestPath,
        archivePath,
        contentId,
        component,
      );

      if (!reusable) {
        const startedAt = Date.now();
        packWindowsResourceComponent7z(component, archivePath, sevenZipPath, files);
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

function signWindowsPythonJobHelper(context, env = process.env, spawn = spawnSync) {
  if (!isWindowsTarget(context) || !env.CERTUM_CERT_THUMBPRINT) return;
  const script = path.join(__dirname, 'runtime-signing', 'sign-runtime.ps1');
  const executable = path.join(context.appOutDir, 'resources', 'python-runtime', 'job-runner.exe');
  const result = spawn(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Path', executable],
    { stdio: 'inherit', windowsHide: true },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Windows Python job helper signing failed with exit code ${result.status}`);
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
  signWindowsPythonJobHelper(context);
}

module.exports = {
  beforePack,
  afterPack,
  signWindowsPythonJobHelper,
  configureMacAutoUpdateMetadata,
  ensureBundledChannelRuntime,
  packWindowsResourceComponent7z,
};
