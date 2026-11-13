import { runCommandCapture } from '../../skills/processRunner';
import { app } from 'electron';
import { existsSync } from 'fs';
import { delimiter, join } from 'path';

import { applyManagedPythonEnv } from '../managedPythonEnv';
import { getFeishuCliBinDirectory } from '../feishuConnectorPaths';
import { applyUvPackageIndexDefaults, PythonPackageIndexUrl } from '../pythonPackageIndexes';
import { coworkLog } from '../coworkLogger';
import { getElectronNodeRuntimePath } from './electronNodeRuntime';
import { appendEnvPath, hasCommandInEnv } from './pathUtils';
import { ensureElectronNodeShim } from './nodeShims';
import { resolveUserShellPath } from './userShellPath';
import { ensureWindowsSystemEnvVars, ensureWindowsSystemPathEntries } from './windowsSystemEnv';
import { ensureWindowsRegistryPathEntries } from './windowsRegistryPath';

const DOMESTIC_NPM_REGISTRY_URL = 'https://registry.npmmirror.com';

export type EnhancedEnvOptions = {
  includePackageMirrors?: boolean;
};

function applyDomesticPackageMirrorDefaults(env: Record<string, string | undefined>): void {
  if (!env.PIP_INDEX_URL) {
    env.PIP_INDEX_URL = PythonPackageIndexUrl.Tsinghua;
  }
  applyUvPackageIndexDefaults(env);

  const hasNpmRegistry = Boolean(env.npm_config_registry || env.NPM_CONFIG_REGISTRY);
  if (!hasNpmRegistry) {
    env.npm_config_registry = DOMESTIC_NPM_REGISTRY_URL;
    env.NPM_CONFIG_REGISTRY = DOMESTIC_NPM_REGISTRY_URL;
  }
}

/**
 * Add application-managed command runtimes to a subprocess environment.
 *
 * This deliberately does not add provider credentials. Callers that need the
 * app's Node/npm shim, managed Python, uv, and Windows system PATH handling
 * can use it without exposing a session's API configuration globally.
 */
export async function applyApplicationRuntimeEnv(
  env: Record<string, string | undefined>,
  options: EnhancedEnvOptions = {},
): Promise<void> {
  const electronNodeRuntimePath = getElectronNodeRuntimePath();
  const includePackageMirrors = options.includePackageMirrors === true;

  if (app.isPackaged && !env.ZHIYUAN_ELECTRON_PATH) {
    env.ZHIYUAN_ELECTRON_PATH = electronNodeRuntimePath;
  }

  if (includePackageMirrors) {
    applyDomesticPackageMirrorDefaults(env);
  }

  // On Windows, normalize UTF-8 settings and ensure system/registry PATH entries are available.
  if (process.platform === 'win32') {
    env.ZHIYUAN_ELECTRON_PATH = electronNodeRuntimePath;

    if (!env.LANG) {
      env.LANG = 'C.UTF-8';
    }
    if (!env.LC_ALL) {
      env.LC_ALL = 'C.UTF-8';
    }

    // Force Python to use UTF-8 mode (PEP 540, Python 3.7+).
    if (!env.PYTHONUTF8) {
      env.PYTHONUTF8 = '1';
    }
    if (!env.PYTHONIOENCODING) {
      env.PYTHONIOENCODING = 'utf-8';
    }

    if (!env.LESSCHARSET) {
      env.LESSCHARSET = 'utf-8';
    }

    // Ensure critical Windows system environment variables are always present.
    ensureWindowsSystemEnvVars(env);

    // Ensure Windows system directories (System32, PowerShell, OpenSSH, etc.) are in PATH.
    ensureWindowsSystemPathEntries(env);

    // Merge the latest PATH entries from the Windows registry (Machine + User).
    // When the Electron app is launched from Explorer/Start Menu, process.env.PATH
    // may be stale and missing tools installed after Explorer started (e.g. Python,
    // Node.js, npm). Reading from the registry ensures we get the latest values,
    // similar to how a freshly opened terminal would.
    await ensureWindowsRegistryPathEntries(env);

    applyManagedPythonEnv(env);
  }

  if (!app.isPackaged) {
    if (process.platform !== 'win32') applyManagedPythonEnv(env);
    // In dev mode, prepend project's node_modules/.bin to PATH so bundled
    // npx/npm are found even if the user has no global Node.js installation.
    const devBinDir = join(app.getAppPath(), 'node_modules', '.bin');
    if (existsSync(devBinDir)) {
      env.PATH = [devBinDir, env.PATH].filter(Boolean).join(delimiter);
      coworkLog(
        'INFO',
        'applyPackagedEnvOverrides',
        `Dev mode: prepended node_modules/.bin to PATH: ${devBinDir}`,
      );
    }

    const feishuCliBinDirectory = getFeishuCliBinDirectory(app.getPath('userData'));
    if (existsSync(feishuCliBinDirectory)) {
      env.PATH = [feishuCliBinDirectory, env.PATH].filter(Boolean).join(delimiter);
    }

    return;
  }

  if (!env.HOME) {
    env.HOME = app.getPath('home');
  }

  // Resolve user's shell PATH so that node, npm, and other tools are findable
  const userPath = await resolveUserShellPath();
  if (userPath) {
    env.PATH = userPath;
    coworkLog(
      'INFO',
      'applyPackagedEnvOverrides',
      `Resolved user shell PATH (${userPath.split(delimiter).length} entries)`,
    );
    for (const entry of userPath.split(delimiter)) {
      coworkLog(
        'INFO',
        'applyPackagedEnvOverrides',
        `  PATH entry: ${entry} (exists: ${existsSync(entry)})`,
      );
    }
  } else if (process.platform !== 'win32') {
    // Fallback on macOS/Linux: append common node installation paths
    const home = env.HOME || app.getPath('home');
    const commonPaths = [
      '/usr/local/bin',
      '/opt/homebrew/bin',
      `${home}/.nvm/current/bin`,
      `${home}/.volta/bin`,
      `${home}/.fnm/current/bin`,
    ];
    env.PATH = [env.PATH, ...commonPaths].filter(Boolean).join(delimiter);
    coworkLog(
      'WARN',
      'applyPackagedEnvOverrides',
      `Failed to resolve user shell PATH, using fallback common paths`,
    );
  }

  const resourcesPath = process.resourcesPath;
  coworkLog('INFO', 'applyPackagedEnvOverrides', `Packaged mode: resourcesPath=${resourcesPath}`);

  // Create node/npx/npm shims that wrap Electron as a Node.js runtime via
  // ELECTRON_RUN_AS_NODE=1 and point npx/npm to the bundled npm package.
  // This avoids relying on node_modules/.bin symlinks which don't work on
  // Windows cross-platform builds.
  const npmBinDir = join(resourcesPath, 'app.asar.unpacked', 'node_modules', 'npm', 'bin');
  coworkLog(
    'INFO',
    'applyPackagedEnvOverrides',
    `npmBinDir=${npmBinDir}, exists=${existsSync(npmBinDir)}`,
  );

  // Set env var so .cmd shims can reference npmBinDir without hardcoding
  // non-ASCII characters (which break on Windows when cmd.exe uses GBK code page).
  env.ZHIYUAN_NPM_BIN_DIR = npmBinDir;

  const [hasSystemNode, hasSystemNpx, hasSystemNpm] = await Promise.all([
    hasCommandInEnv('node', env),
    hasCommandInEnv('npx', env),
    hasCommandInEnv('npm', env),
  ]);
  const shouldForcePackagedDarwinShim = app.isPackaged && process.platform === 'darwin';
  const shouldInjectShim =
    shouldForcePackagedDarwinShim ||
    process.platform === 'win32' ||
    !(hasSystemNode && hasSystemNpx && hasSystemNpm);
  if (shouldInjectShim) {
    const shimDir = ensureElectronNodeShim(electronNodeRuntimePath, npmBinDir);
    if (shimDir) {
      env.PATH = [shimDir, env.PATH].filter(Boolean).join(delimiter);
      env.ZHIYUAN_NODE_SHIM_ACTIVE = '1';
      coworkLog(
        'INFO',
        'resolveNodeShim',
        `Injected Electron Node/npx/npm shim PATH entry: ${shimDir}`,
      );
      if (shouldForcePackagedDarwinShim) {
        coworkLog(
          'INFO',
          'resolveNodeShim',
          'Packaged macOS build: forcing bundled Electron node/npx/npm shims to avoid stale system Node versions',
        );
      }
    }
  } else {
    delete env.ZHIYUAN_NODE_SHIM_ACTIVE;
    coworkLog(
      'INFO',
      'resolveNodeShim',
      'System node/npx/npm detected; skipped Electron node shim injection',
    );
  }

  const nodePaths = [
    join(resourcesPath, 'app.asar', 'node_modules'),
    join(resourcesPath, 'app.asar.unpacked', 'node_modules'),
  ].filter(nodePath => existsSync(nodePath));

  if (nodePaths.length > 0) {
    env.NODE_PATH = appendEnvPath(env.NODE_PATH, nodePaths);
  }

  // Managed Python for ad-hoc scripts: prefer the Skill shared layer (carries
  // pandas/numpy/...), with the bare base runtime as fallback. Windows already
  // applied both in the platform block above; re-running would re-prepend the
  // base runtime ahead of the shared layer.
  if (process.platform !== 'win32') {
    applyManagedPythonEnv(env);
  }

  // Official connector Skills invoke lark-cli by name. Keep its per-user
  // launcher ahead of system paths so a globally installed, incompatible CLI
  // cannot shadow the app-bundled version.
  const feishuCliBinDirectory = getFeishuCliBinDirectory(app.getPath('userData'));
  if (existsSync(feishuCliBinDirectory)) {
    env.PATH = [feishuCliBinDirectory, env.PATH].filter(Boolean).join(delimiter);
  }

  // Verify node/npx/npm resolution in the constructed environment
  await verifyNodeEnvironment(env);
}

/**
 * Verify that node/npx/npm can be resolved from the constructed environment PATH.
 * Logs diagnostic info for debugging MCP server startup issues on macOS.
 */
async function verifyNodeEnvironment(env: Record<string, string | undefined>): Promise<void> {
  const tag = 'verifyNodeEnv';
  const pathValue = env.PATH || '';

  // Log final PATH entries
  const pathEntries = pathValue.split(delimiter);
  coworkLog('INFO', tag, `Final PATH has ${pathEntries.length} entries:`);
  for (let i = 0; i < pathEntries.length; i++) {
    const entry = pathEntries[i];
    const exists = entry ? existsSync(entry) : false;
    coworkLog('INFO', tag, `  [${i}] ${entry} (exists: ${exists})`);
  }

  // Try to resolve node, npx, npm using 'which' (macOS/Linux) or 'where' (Windows)
  const whichCmd = process.platform === 'win32' ? 'where' : 'which';
  for (const tool of ['node', 'npx', 'npm']) {
    try {
      const { stdout } = await runCommandCapture(whichCmd, [tool], {
        env: { ...env } as NodeJS.ProcessEnv,
        timeoutMs: 5000,
      });
      {
        const resolved = stdout.trim();
        coworkLog('INFO', tag, `${whichCmd} ${tool} => ${resolved}`);
        const resolvedCandidates = resolved
          .split(/\r?\n/)
          .map(line => line.trim())
          .filter(Boolean);
        const resolvedForExec =
          process.platform === 'win32'
            ? resolvedCandidates.find(candidate => /\.(cmd|exe|bat)$/i.test(candidate)) ||
              resolvedCandidates[0]
            : resolvedCandidates[0];

        // Try to get version
        if (tool === 'node' && resolvedForExec) {
          try {
            let execTarget = resolvedForExec;
            if (process.platform === 'win32' && /\.cmd$/i.test(resolvedForExec)) {
              execTarget = env.ZHIYUAN_ELECTRON_PATH || process.execPath;
            }
            const { stdout: versionStdout, stderr: versionStderr } = await runCommandCapture(
              execTarget,
              ['--version'],
              {
                env: { ...env, ELECTRON_RUN_AS_NODE: '1' } as NodeJS.ProcessEnv,
                timeoutMs: 5000,
              },
            );
            coworkLog('INFO', tag, `node --version (${execTarget}) => ${versionStdout.trim()}`);
            if (versionStderr) {
              coworkLog('WARN', tag, `node --version stderr: ${versionStderr.trim()}`);
            }
          } catch (e) {
            coworkLog(
              'WARN',
              tag,
              `node --version failed: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        }
      }
    } catch (e) {
      coworkLog(
        'WARN',
        tag,
        `${whichCmd} ${tool} threw: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // Log key env vars
  coworkLog('INFO', tag, `NODE_PATH=${env.NODE_PATH || '(not set)'}`);
  coworkLog('INFO', tag, `ZHIYUAN_ELECTRON_PATH=${env.ZHIYUAN_ELECTRON_PATH || '(not set)'}`);
  coworkLog('INFO', tag, `ZHIYUAN_NPM_BIN_DIR=${env.ZHIYUAN_NPM_BIN_DIR || '(not set)'}`);
  coworkLog('INFO', tag, `HOME=${env.HOME || '(not set)'}`);
}
