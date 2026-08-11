'use strict';

const path = require('path');
const os = require('os');
const {
  existsSync,
  readdirSync,
  statSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  cpSync,
  lstatSync,
  writeFileSync,
  symlinkSync,
} = require('fs');
const { spawnSync } = require('child_process');
const asar = require('@electron/asar');
const { ensurePortablePythonRuntime, checkRuntimeHealth } = require('./setup-python-runtime.js');
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
const { ensurePortableGit } = require('./setup-mingit.js');
const {
  ensureSkillPythonRuntimes,
  checkSkillPythonRuntimeHealth,
} = require('./setup-skill-python-runtime.js');
const { syncLocalOpenClawExtensions } = require('./sync-local-openclaw-extensions.cjs');
const {
  buildWindowsResourceBundleManifest,
  buildWindowsResourceComponentManifest,
  computeWindowsResourceComponentId,
  getWindowsResourceComponents,
  isWindowsResourceComponentReusable,
  sha256File,
} = require('./windows-resource-pack.cjs');
const {
  DIST_DIFFS_EXTENSION_DIR,
  DIST_EXTENSIONS_DIR,
  summarizeGatewayAsarEntries,
} = require('./openclaw-runtime-packaging.cjs');

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
  if (process.arch === 'arm64') return 'arm64';
  if (process.arch === 'ia32') return 'ia32';
  return 'x64';
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

function packWindowsResourceComponent7z(component, archivePath, sevenZipPath) {
  const stagingRoot = mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-component-7z-'));
  const stagedPrefix = path.join(stagingRoot, component.prefix);
  try {
    // A junction keeps the archive layout stable without copying a multi-hundred-MB
    // component into a temporary staging directory.  The archive is created from
    // the relative prefix only, so it never contains an absolute build-machine path.
    symlinkSync(component.dir, stagedPrefix, 'junction');
    const result = spawnSync(
      sevenZipPath,
      ['a', '-t7z', '-mx=9', '-m0=lzma2', '-ms=off', '-mmt=on', archivePath, component.prefix],
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
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
}

function resolveOpenClawRuntimeTargetId(context) {
  const platform = context?.electronPlatformName;
  const arch = resolveTargetArch(context);

  if (platform === 'darwin') {
    return arch === 'x64' ? 'mac-x64' : 'mac-arm64';
  }
  if (platform === 'win32') {
    return arch === 'arm64' ? 'win-arm64' : 'win-x64';
  }
  if (platform === 'linux') {
    return arch === 'arm64' ? 'linux-arm64' : 'linux-x64';
  }

  return null;
}

function readRuntimeBuildInfo(runtimeRoot) {
  const buildInfoPath = path.join(runtimeRoot, 'runtime-build-info.json');
  if (!existsSync(buildInfoPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(buildInfoPath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function getOpenClawRuntimeBuildHint(targetId) {
  if (!targetId) {
    return 'npm run openclaw:runtime:host';
  }
  return `npm run openclaw:runtime:${targetId}`;
}

function syncCurrentOpenClawRuntimeForTarget(context) {
  const runtimeBase = path.join(__dirname, '..', 'vendor', 'openclaw-runtime');
  const currentRoot = path.join(runtimeBase, 'current');
  const targetId = resolveOpenClawRuntimeTargetId(context);

  if (!targetId) {
    return { runtimeRoot: currentRoot, targetId: null };
  }

  const targetRoot = path.join(runtimeBase, targetId);
  if (!existsSync(targetRoot)) {
    return { runtimeRoot: currentRoot, targetId };
  }

  const currentBuildInfo = readRuntimeBuildInfo(currentRoot);
  if (currentBuildInfo?.target !== targetId) {
    rmSync(currentRoot, { recursive: true, force: true });
    cpSync(targetRoot, currentRoot, { recursive: true, force: true });
    console.log(`[electron-builder-hooks] Synced OpenClaw runtime ${targetId} -> current`);
  }

  return { runtimeRoot: currentRoot, targetId };
}

function verifyPreinstalledPlugins(runtimeRoot, buildHint) {
  const pkgPath = path.join(__dirname, '..', 'package.json');
  let plugins = [];
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    plugins = (pkg.openclaw && pkg.openclaw.plugins) || [];
  } catch {
    return; // Cannot read package.json — skip verification
  }

  if (!Array.isArray(plugins) || plugins.length === 0) {
    return;
  }

  const extensionsDir = path.join(runtimeRoot, 'third-party-extensions');
  const missing = [];

  for (const plugin of plugins) {
    if (!plugin.id) continue;
    const pluginDir = path.join(extensionsDir, plugin.id);
    if (!existsSync(pluginDir)) {
      missing.push(plugin.id);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      '[electron-builder-hooks] Preinstalled OpenClaw plugins missing from runtime: ' +
        missing.join(', ') +
        `. Run \`${buildHint}\` (which includes openclaw:plugins) before packaging.`,
    );
  }

  console.log(
    `[electron-builder-hooks] Verified ${plugins.length} preinstalled OpenClaw plugin(s).`,
  );
}

function hasCompiledLocalExtension(runtimeRoot, extensionId) {
  const pluginDir = path.join(runtimeRoot, 'third-party-extensions', extensionId);
  return (
    existsSync(path.join(pluginDir, 'openclaw.plugin.json')) &&
    existsSync(path.join(pluginDir, 'index.js'))
  );
}

function precompileLocalExtensions(runtimeRoot, buildHint) {
  const scriptPath = path.join(__dirname, 'precompile-openclaw-extensions.cjs');
  const result = spawnSync(process.execPath, [scriptPath, runtimeRoot], {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    throw new Error(
      '[electron-builder-hooks] Failed to precompile local OpenClaw extensions. ' +
        `Run \`${buildHint}\` before packaging.`,
    );
  }
}

function ensureBundledLocalExtensions(runtimeRoot, buildHint) {
  const requiredLocalExtensions = ['mcp-bridge', 'ask-user-question'];
  const missingCompiledExtensions = requiredLocalExtensions.filter(
    extensionId => !hasCompiledLocalExtension(runtimeRoot, extensionId),
  );

  if (missingCompiledExtensions.length === 0) {
    return;
  }

  console.log(
    '[electron-builder-hooks] Restoring local OpenClaw extensions before packaging: ' +
      missingCompiledExtensions.join(', '),
  );
  syncLocalOpenClawExtensions(runtimeRoot);
  precompileLocalExtensions(runtimeRoot, buildHint);

  const stillMissing = requiredLocalExtensions.filter(
    extensionId => !hasCompiledLocalExtension(runtimeRoot, extensionId),
  );
  if (stillMissing.length > 0) {
    throw new Error(
      '[electron-builder-hooks] Bundled OpenClaw runtime is missing compiled local extensions: ' +
        stillMissing.join(', ') +
        `. Run \`${buildHint}\` before packaging.`,
    );
  }
}

function ensureBundledOpenClawRuntime(context) {
  const { runtimeRoot, targetId } = syncCurrentOpenClawRuntimeForTarget(context);
  const buildHint = getOpenClawRuntimeBuildHint(targetId);

  ensureBundledLocalExtensions(runtimeRoot, buildHint);

  const requiredExternalPaths = [path.join(runtimeRoot, 'node_modules')];
  const missingExternal = requiredExternalPaths.filter(candidate => !existsSync(candidate));
  if (missingExternal.length > 0) {
    throw new Error(
      '[electron-builder-hooks] Bundled OpenClaw runtime is incomplete. Missing: ' +
        missingExternal.join(', ') +
        `. Run \`${buildHint}\` before packaging.`,
    );
  }

  // Verify preinstalled plugins are present in the runtime extensions directory
  verifyPreinstalledPlugins(runtimeRoot, buildHint);

  // Verify gateway-bundle.mjs exists and is reasonably sized.
  // Without it, Windows first-launch falls back to loading ~1100 ESM modules
  // individually, causing 80-100s startup delay.
  const gatewayBundlePath = path.join(runtimeRoot, 'gateway-bundle.mjs');
  if (!existsSync(gatewayBundlePath)) {
    throw new Error(
      '[electron-builder-hooks] gateway-bundle.mjs is missing from ' +
        runtimeRoot +
        '. Run `npm run openclaw:bundle` before packaging.',
    );
  }
  const gatewayBundleStat = statSync(gatewayBundlePath);
  if (gatewayBundleStat.size < 1_000_000) {
    throw new Error(
      '[electron-builder-hooks] gateway-bundle.mjs is suspiciously small (' +
        gatewayBundleStat.size +
        ' bytes, expected ~27MB). Rebuild with: `npm run openclaw:bundle`.',
    );
  }

  const gatewayAsarPath = path.join(runtimeRoot, 'gateway.asar');
  if (existsSync(gatewayAsarPath)) {
    let summary;
    try {
      summary = summarizeGatewayAsarEntries(asar.listPackage(gatewayAsarPath));
    } catch (error) {
      throw new Error(
        '[electron-builder-hooks] Failed to read OpenClaw gateway.asar: ' +
          `${gatewayAsarPath}. ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (
      !summary.hasOpenClawEntry ||
      !summary.hasControlUiIndex ||
      !summary.hasGatewayEntry ||
      summary.hasBundledExtensions
    ) {
      throw new Error(
        '[electron-builder-hooks] OpenClaw gateway.asar is incomplete. ' +
          `openclaw.mjs=${summary.hasOpenClawEntry}, control-ui=${summary.hasControlUiIndex}, entry=${summary.hasGatewayEntry}, extensions=${summary.hasBundledExtensions}.`,
      );
    }

    const bundledExtensionsDir = path.join(runtimeRoot, DIST_EXTENSIONS_DIR);
    if (!existsSync(bundledExtensionsDir)) {
      throw new Error(
        '[electron-builder-hooks] Bundled OpenClaw runtime is missing bare dist/extensions. ' +
          `Expected ${bundledExtensionsDir} after gateway.asar packing.`,
      );
    }

    const diffsExtensionDir = path.join(runtimeRoot, DIST_DIFFS_EXTENSION_DIR);
    if (existsSync(diffsExtensionDir)) {
      throw new Error(
        '[electron-builder-hooks] Bundled OpenClaw runtime still contains the diffs extension. ' +
          `Expected ${diffsExtensionDir} to be removed before packaging.`,
      );
    }

    return;
  }

  const legacyRequiredPaths = [
    path.join(runtimeRoot, 'openclaw.mjs'),
    path.join(runtimeRoot, 'dist', 'control-ui', 'index.html'),
  ];

  const hasLegacyEntry =
    existsSync(path.join(runtimeRoot, 'dist', 'entry.js')) ||
    existsSync(path.join(runtimeRoot, 'dist', 'entry.mjs'));
  if (!hasLegacyEntry) {
    throw new Error(
      '[electron-builder-hooks] Missing OpenClaw runtime entry. ' +
        `Expected ${path.join(runtimeRoot, 'dist', 'entry.js')} or ${path.join(runtimeRoot, 'dist', 'entry.mjs')}, ` +
        `or ${path.join(runtimeRoot, 'gateway.asar')}.`,
    );
  }

  const missingLegacy = legacyRequiredPaths.filter(candidate => !existsSync(candidate));
  if (missingLegacy.length > 0) {
    throw new Error(
      '[electron-builder-hooks] Bundled OpenClaw legacy runtime is incomplete. Missing: ' +
        missingLegacy.join(', ') +
        `. Run \`${buildHint}\` before packaging.`,
    );
  }
}

function findPackagedBash(appOutDir) {
  const candidates = [
    path.join(appOutDir, 'resources', 'mingit', 'bin', 'bash.exe'),
    path.join(appOutDir, 'resources', 'mingit', 'usr', 'bin', 'bash.exe'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function verifyPackagedPortableGitRuntimeDirs(appOutDir) {
  const requiredDirs = [
    path.join(appOutDir, 'resources', 'mingit', 'dev', 'shm'),
    path.join(appOutDir, 'resources', 'mingit', 'dev', 'mqueue'),
  ];
  const createdDirs = [];

  for (const dir of requiredDirs) {
    if (existsSync(dir)) continue;
    mkdirSync(dir, { recursive: true });
    createdDirs.push(dir);
  }

  const missingDirs = requiredDirs.filter(dir => !existsSync(dir));
  if (missingDirs.length > 0) {
    throw new Error(
      'Windows package is missing required PortableGit runtime directories. ' +
        `Missing: ${missingDirs.join(', ')}`,
    );
  }

  if (createdDirs.length > 0) {
    console.log(
      '[electron-builder-hooks] Created missing PortableGit runtime directories: ' +
        createdDirs.join(', '),
    );
  }

  console.log(
    '[electron-builder-hooks] Verified PortableGit runtime directories: ' + requiredDirs.join(', '),
  );
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
  console.log(
    '[electron-builder-hooks] Applying macOS icon fix for Apple Silicon compatibility...',
  );

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

  // Check if CFBundleIconName already exists
  const checkResult = spawnSync('plutil', ['-extract', 'CFBundleIconName', 'raw', infoPlistPath], {
    encoding: 'utf-8',
  });

  if (checkResult.status !== 0) {
    // CFBundleIconName doesn't exist, add it
    console.log('[electron-builder-hooks] Adding CFBundleIconName to Info.plist...');
    const addResult = spawnSync(
      'plutil',
      ['-insert', 'CFBundleIconName', '-string', 'icon', infoPlistPath],
      { encoding: 'utf-8' },
    );

    if (addResult.status === 0) {
      console.log('[electron-builder-hooks] ✓ CFBundleIconName added successfully');
    } else {
      console.warn('[electron-builder-hooks] Failed to add CFBundleIconName:', addResult.stderr);
    }
  } else {
    console.log('[electron-builder-hooks] ✓ CFBundleIconName already present');
  }

  // Clear extended attributes
  spawnSync('xattr', ['-cr', appPath], { encoding: 'utf-8' });

  // Touch the app to update modification time
  spawnSync('touch', [appPath], { encoding: 'utf-8' });
  spawnSync('touch', [resourcesPath], { encoding: 'utf-8' });

  console.log('[electron-builder-hooks] ✓ macOS icon fix applied');
}

/**
 * Remove all node_modules/.bin directories from the cfmind tree.
 *
 * macOS codesign rejects symlinks inside app bundles (even valid relative ones).
 * .bin/ directories contain only CLI wrapper symlinks that are never used at
 * runtime, so removing them entirely is safe and fixes signing.
 */
function removeAllBinDirsInCfmind(appOutDir) {
  const cfmindDir = path.join(appOutDir, 'Contents', 'Resources', 'cfmind');

  if (!existsSync(cfmindDir)) {
    return;
  }

  console.log('[electron-builder-hooks] Removing node_modules/.bin directories from cfmind...');

  let removedCount = 0;
  const walk = dir => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (!entry.isDirectory()) continue;
      if (entry.name === '.bin' && path.basename(path.dirname(full)) === 'node_modules') {
        rmSync(full, { recursive: true, force: true });
        removedCount++;
        continue;
      }
      walk(full);
    }
  };
  walk(cfmindDir);

  console.log(
    `[electron-builder-hooks] ✓ Removed ${removedCount} .bin director${removedCount === 1 ? 'y' : 'ies'} from cfmind`,
  );
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

async function beforePack(context) {
  configureMacAutoUpdateMetadata(context);
  ensureBundledOpenClawRuntime(context);
  // Install skill dependencies first (for all platforms)
  installSkillDependencies();

  if (isWindowsTarget(context)) {
    console.log(
      '[electron-builder-hooks] Windows target detected, ensuring bundled PortableGit...',
    );
    await ensurePortableGit({ required: true });
    const portableGitRoot = path.join(__dirname, '..', 'resources', 'mingit');
    const portableGitBash = [
      path.join(portableGitRoot, 'bin', 'bash.exe'),
      path.join(portableGitRoot, 'usr', 'bin', 'bash.exe'),
    ].find(candidate => existsSync(candidate));
    if (!portableGitBash) {
      throw new Error('Bundled PortableGit health check failed before pack: bash.exe is missing.');
    }

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
    const skillPythonHealth = checkSkillPythonRuntimeHealth({
      platform: targetPlatform,
      arch: targetArch,
    });
    if (!skillPythonHealth.ok) {
      throw new Error(
        'Bundled Skill Python runtime health check failed before pack. Missing: ' +
          skillPythonHealth.missing.join(', '),
      );
    }
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
          `[electron-builder-hooks] Packed ${component.key} ${contentId} in ${(
            (Date.now() - startedAt) /
            1000
          ).toFixed(1)}s`,
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
  }

  if (!isWindowsTarget(context)) {
    return;
  }
}

async function afterPack(context) {
  if (isMacTarget(context)) {
    const appName = context.packager.appInfo.productFilename;
    const appPath = path.join(context.appOutDir, `${appName}.app`);

    if (existsSync(appPath)) {
      // Remove all .bin directories (symlinks) before signing to prevent codesign failures
      removeAllBinDirsInCfmind(appPath);
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
};
