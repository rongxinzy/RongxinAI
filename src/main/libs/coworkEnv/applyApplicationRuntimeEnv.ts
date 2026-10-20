import { spawnSync } from 'child_process';
import { app } from 'electron';
import { existsSync } from 'fs';
import { delimiter, join } from 'path';

import { applyManagedPythonEnv } from '../managedPythonEnv';
import { getFeishuCliBinDirectory } from '../feishuConnectorPaths';
import { applyUvPackageIndexDefaults, PythonPackageIndexUrl } from '../pythonPackageIndexes';
import { coworkLog } from '../coworkLogger';
import { getElectronNodeRuntimePath } from './electronNodeRuntime';
import {
  checkWindowsGitBashHealth,
  getGitBashResolutionErrorForPi,
  getWindowsGitToolDirs,
  resolveWindowsGitBashPath,
} from './gitBash';
import {
  appendEnvPath,
  hasCommandInEnv,
  normalizeWindowsPath,
  singleWindowsPathToPosix,
  truncateDiagnostic,
} from './pathUtils';
import { ensureElectronNodeShim } from './nodeShims';
import { resolveUserShellPath } from './userShellPath';
import {
  ensureWindowsBashBootstrapPath,
  ensureWindowsBashUtf8InitScript,
  ensureWindowsOriginalPath,
  ensureWindowsSystemEnvVars,
  ensureWindowsSystemPathEntries,
} from './windowsSystemEnv';
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
 * app's Node/npm shim, managed Python, uv, and Windows Git Bash PATH handling
 * can use it without exposing a session's API configuration globally.
 */
export function applyApplicationRuntimeEnv(
  env: Record<string, string | undefined>,
  options: EnhancedEnvOptions = {},
): void {
  const electronNodeRuntimePath = getElectronNodeRuntimePath();
  const includePackageMirrors = options.includePackageMirrors === true;

  if (app.isPackaged && !env.ZHIYUAN_ELECTRON_PATH) {
    env.ZHIYUAN_ELECTRON_PATH = electronNodeRuntimePath;
  }

  if (includePackageMirrors) {
    applyDomesticPackageMirrorDefaults(env);
  }

  // On Windows, resolve git-bash and ensure Git toolchain directories are available in PATH.
  if (process.platform === 'win32') {
    env.ZHIYUAN_ELECTRON_PATH = electronNodeRuntimePath;

    // Force UTF-8 encoding for MSYS2/git-bash.
    //
    // On Chinese (and other non-Latin) Windows systems, the default system locale
    // uses GBK (code page 936) or similar legacy encodings. Without explicit locale
    // settings, MSYS2 tools and the git-bash environment may output text in the
    // system's legacy encoding, which the Claude Agent SDK misinterprets as UTF-8,
    // producing garbled characters.
    //
    // Setting LANG and LC_ALL to C.UTF-8 tells the MSYS2 runtime to use UTF-8 for
    // all text I/O, including output from coreutils (ls, cat, grep, etc.).
    if (!env.LANG) {
      env.LANG = 'C.UTF-8';
    }
    if (!env.LC_ALL) {
      env.LC_ALL = 'C.UTF-8';
    }

    // Force Python to use UTF-8 mode (PEP 540, Python 3.7+).
    // Without this, Python on Chinese Windows defaults to GBK for stdin/stdout/stderr
    // and file I/O, causing garbled output when the SDK reads it as UTF-8.
    if (!env.PYTHONUTF8) {
      env.PYTHONUTF8 = '1';
    }
    if (!env.PYTHONIOENCODING) {
      env.PYTHONIOENCODING = 'utf-8';
    }

    // Force `less` and `git` pager output to use UTF-8.
    if (!env.LESSCHARSET) {
      env.LESSCHARSET = 'utf-8';
    }

    // Create a bash init script that switches the Windows console code page to
    // UTF-8 (65001). By setting BASH_ENV, every non-interactive bash session
    // spawned by the Claude Agent SDK will source this script before executing
    // commands, ensuring Windows native commands (dir, ipconfig, systeminfo,
    // type, etc.) output UTF-8 instead of GBK.
    if (!env.BASH_ENV) {
      const initScript = ensureWindowsBashUtf8InitScript();
      if (initScript) {
        // Convert to MSYS2 POSIX format to avoid encoding issues when the
        // path contains non-ASCII characters (e.g. Chinese Windows username).
        // MSYS2's automatic Windows→POSIX conversion can corrupt non-ASCII
        // chars if it runs before LANG=C.UTF-8 takes effect during DLL init.
        env.BASH_ENV = singleWindowsPathToPosix(initScript);
        coworkLog(
          'INFO',
          'applyPackagedEnvOverrides',
          `Set BASH_ENV for UTF-8 console code page: ${env.BASH_ENV}`,
        );
      }
    }

    // Ensure critical Windows system environment variables are always present.
    // Packaged Electron apps or certain launch contexts may lack these variables,
    // which causes Windows built-in commands (ipconfig, systeminfo, netstat, etc.)
    // to fail when executed inside git-bash via the Claude Agent SDK.
    ensureWindowsSystemEnvVars(env);

    // Ensure Windows system directories (System32, etc.) are always in PATH.
    // The Claude Agent SDK's shell snapshot mechanism captures PATH and may lose
    // system directories if they were missing from the inherited environment.
    ensureWindowsSystemPathEntries(env);

    // Merge the latest PATH entries from the Windows registry (Machine + User).
    // When the Electron app is launched from Explorer/Start Menu, process.env.PATH
    // may be stale and missing tools installed after Explorer started (e.g. Python,
    // Node.js, npm). Reading from the registry ensures we get the latest values,
    // similar to how a freshly opened terminal would.
    ensureWindowsRegistryPathEntries(env);

    const configuredBashPath = normalizeWindowsPath(env.CLAUDE_CODE_GIT_BASH_PATH);
    let bashPath =
      configuredBashPath && existsSync(configuredBashPath)
        ? configuredBashPath
        : resolveWindowsGitBashPath();

    if (configuredBashPath && bashPath === configuredBashPath) {
      const configuredHealth = checkWindowsGitBashHealth(configuredBashPath);
      if (!configuredHealth.ok) {
        const fallbackPath = resolveWindowsGitBashPath();
        if (fallbackPath && fallbackPath !== configuredBashPath) {
          coworkLog(
            'WARN',
            'resolveGitBash',
            `Configured bash is unhealthy (${configuredBashPath}): ${configuredHealth.reason || 'unknown reason'}. Falling back to: ${fallbackPath}`,
          );
          bashPath = fallbackPath;
        } else {
          const diagnostic = truncateDiagnostic(
            `Configured bash is unhealthy (${configuredBashPath}): ${configuredHealth.reason || 'unknown reason'}`,
          );
          env.ZHIYUAN_GIT_BASH_RESOLUTION_ERROR = diagnostic;
          coworkLog('WARN', 'resolveGitBash', diagnostic);
          bashPath = null;
        }
      }
    }

    if (bashPath) {
      env.CLAUDE_CODE_GIT_BASH_PATH = bashPath;
      delete env.ZHIYUAN_GIT_BASH_RESOLUTION_ERROR;
      coworkLog('INFO', 'resolveGitBash', `Using Windows git-bash: ${bashPath}`);
      const gitToolDirs = getWindowsGitToolDirs(bashPath);
      env.PATH = appendEnvPath(env.PATH, gitToolDirs);
      coworkLog(
        'INFO',
        'resolveGitBash',
        `Injected Windows Git toolchain PATH entries: ${gitToolDirs.join(', ')}`,
      );
      ensureWindowsBashBootstrapPath(env);
    } else {
      const diagnostic =
        getGitBashResolutionErrorForPi() || 'git-bash not found or failed health checks';
      env.ZHIYUAN_GIT_BASH_RESOLUTION_ERROR = truncateDiagnostic(diagnostic);
    }

    applyManagedPythonEnv(env);

    // Tell git-bash to inherit the PATH from the parent process instead of
    // rebuilding it from scratch. Without this, git-bash's /etc/profile (login
    // shell) defaults to constructing a minimal PATH containing only Windows
    // system directories + MSYS2 tools, discarding user-installed tool paths
    // like Python, Node.js, npm, pip, etc. Setting MSYS2_PATH_TYPE=inherit
    // makes git-bash preserve the full PATH we've carefully constructed above.
    if (!env.MSYS2_PATH_TYPE) {
      env.MSYS2_PATH_TYPE = 'inherit';
      coworkLog(
        'INFO',
        'applyPackagedEnvOverrides',
        'Set MSYS2_PATH_TYPE=inherit to preserve PATH in git-bash',
      );
    }

    // Pre-set ORIGINAL_PATH in POSIX format so git-bash's /etc/profile can use it.
    //
    // ROOT CAUSE: Node.js env PATH on Windows uses semicolons (;) and backslash
    // paths (C:\...). When the Claude Agent SDK's CLI spawns git-bash with this env,
    // /etc/profile reads ORIGINAL_PATH="${ORIGINAL_PATH:-${PATH}}" and appends it
    // with a colon. But the semicolons in the Windows PATH are NOT converted to
    // colons, so "C:\nodejs;C:\python" becomes one giant invalid entry instead of
    // two separate paths. This causes `npm`, `python`, `pip` etc. to be unfindable.
    //
    // By pre-setting ORIGINAL_PATH to the POSIX-converted version (/c/nodejs:/c/python),
    // /etc/profile uses it directly and bash can correctly parse all PATH entries.
    // This MUST be done AFTER all PATH modifications above so the full PATH is captured.
    ensureWindowsOriginalPath(env);
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
      if (process.platform === 'win32') ensureWindowsOriginalPath(env);
    }

    return;
  }

  if (!env.HOME) {
    env.HOME = app.getPath('home');
  }

  // Resolve user's shell PATH so that node, npm, and other tools are findable
  const userPath = resolveUserShellPath();
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

  const hasSystemNode = hasCommandInEnv('node', env);
  const hasSystemNpx = hasCommandInEnv('npx', env);
  const hasSystemNpm = hasCommandInEnv('npm', env);
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

      // Re-compute ORIGINAL_PATH after shim injection so that git-bash
      // also sees the bundled node/npx/npm in its PATH.
      if (process.platform === 'win32') {
        ensureWindowsOriginalPath(env);
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
    if (process.platform === 'win32') ensureWindowsOriginalPath(env);
  }

  // Verify node/npx/npm resolution in the constructed environment
  verifyNodeEnvironment(env);
}

/**
 * Verify that node/npx/npm can be resolved from the constructed environment PATH.
 * Logs diagnostic info for debugging MCP server startup issues on macOS.
 */
function verifyNodeEnvironment(env: Record<string, string | undefined>): void {
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
      const result = spawnSync(whichCmd, [tool], {
        env: { ...env } as NodeJS.ProcessEnv,
        encoding: 'utf-8',
        timeout: 5000,
        windowsHide: process.platform === 'win32',
      });
      if (result.status === 0 && result.stdout) {
        const resolved = result.stdout.trim();
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
            const versionResult = spawnSync(execTarget, ['--version'], {
              env: { ...env, ELECTRON_RUN_AS_NODE: '1' } as NodeJS.ProcessEnv,
              encoding: 'utf-8',
              timeout: 5000,
              windowsHide: process.platform === 'win32',
            });
            coworkLog(
              'INFO',
              tag,
              `node --version (${execTarget}) => ${(versionResult.stdout || '').trim()} (exit: ${versionResult.status})`,
            );
            if (versionResult.error) {
              coworkLog('WARN', tag, `node --version spawn error: ${versionResult.error.message}`);
            }
            if (versionResult.stderr) {
              coworkLog('WARN', tag, `node --version stderr: ${versionResult.stderr.trim()}`);
            }
          } catch (e) {
            coworkLog(
              'WARN',
              tag,
              `node --version failed: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        }
      } else {
        coworkLog(
          'WARN',
          tag,
          `${whichCmd} ${tool} => NOT FOUND (exit: ${result.status}, stderr: ${(result.stderr || '').trim()})`,
        );
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
