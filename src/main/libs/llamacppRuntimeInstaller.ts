import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

import type {
  LlamaCppRuntimeInstallPlan,
  LlamaCppRuntimeInstallResult,
} from '../../shared/llamacpp';

const execFileAsync = promisify(execFile);

export type CMakeDependencyInstallPlan =
  | {
    kind: 'install';
    command: string;
    args: string[];
    message: string;
  }
  | {
    kind: 'needs-manual';
    message: string;
  };

export type CMakeDependencyInstallResult = {
  success: boolean;
  cmakePath?: string;
  plan?: CMakeDependencyInstallPlan;
  error?: string;
};

export type LlamaCppRuntimeInstallContext = {
  platform: NodeJS.Platform;
  arch: string;
  isPackaged: boolean;
  existingExecutablePath: string | null;
  projectRoot: string;
  sourceDir: string;
  sourceExists: boolean;
  buildScriptExists: boolean;
  cmakePath?: string | null;
  nodePath?: string | null;
};

export function resolveLlamaCppExecutableName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'llama-server.exe' : 'llama-server';
}

export function resolveLlamaCppRuntimeTargetId(platform: NodeJS.Platform, arch: string): string | null {
  const normalizedArch = arch === 'arm64' ? 'arm64' : arch === 'ia32' ? 'ia32' : 'x64';
  if (platform === 'darwin') return normalizedArch === 'x64' ? 'mac-x64' : 'mac-arm64';
  if (platform === 'win32') return normalizedArch === 'arm64' ? 'win-arm64' : 'win-x64';
  if (platform === 'linux') return normalizedArch === 'arm64' ? 'linux-arm64' : 'linux-x64';
  return null;
}

export function createLlamaCppRuntimeInstallPlan(context: LlamaCppRuntimeInstallContext): LlamaCppRuntimeInstallPlan {
  if (context.existingExecutablePath) {
    return {
      kind: 'ready',
      executablePath: context.existingExecutablePath,
    };
  }

  const targetId = resolveLlamaCppRuntimeTargetId(context.platform, context.arch);
  if (!targetId) {
    return {
      kind: 'needs-manual',
      message: `Unsupported platform for bundled llama.cpp runtime: ${context.platform}/${context.arch}.`,
    };
  }

  if (context.isPackaged) {
    return {
      kind: 'needs-manual',
      message: 'The packaged app is missing the bundled llama.cpp runtime. Please reinstall using the full installer that includes resources/llamacpp.',
    };
  }

  if (!context.sourceExists) {
    return {
      kind: 'needs-manual',
      message: `llama.cpp source directory was not found: ${context.sourceDir}. Set LLAMACPP_SRC to a local llama.cpp checkout and try again.`,
    };
  }

  const scriptPath = path.join(context.projectRoot, 'scripts', 'run-build-llamacpp-runtime.cjs');
  if (!context.buildScriptExists) {
    return {
      kind: 'needs-manual',
      message: `llama.cpp runtime build script was not found: ${scriptPath}.`,
    };
  }

  if (context.platform === 'win32') {
    return {
      kind: 'needs-manual',
      message: 'Windows development builds require Git Bash, CMake, and MSVC. Build the runtime with npm run llamacpp:runtime:win-x64, or use a full installer that includes resources/llamacpp.',
    };
  }

  if (!context.cmakePath) {
    return {
      kind: 'needs-manual',
      message: 'CMake is required to build llama.cpp runtime but was not found. Install CMake first, for example on macOS: brew install cmake.',
    };
  }

  return {
    kind: 'build',
    targetId,
    scriptPath,
    sourceDir: context.sourceDir,
  };
}

export async function executeLlamaCppRuntimeInstallPlan(
  plan: LlamaCppRuntimeInstallPlan,
  options: {
    projectRoot: string;
    sourceDir: string;
    cmakePath?: string | null;
    nodePath?: string | null;
    findExecutable: () => Promise<string | null>;
    syncRuntimeCurrent?: (targetId: string) => Promise<void>;
  },
): Promise<LlamaCppRuntimeInstallResult> {
  if (plan.kind === 'ready') {
    return {
      success: true,
      plan,
      executablePath: plan.executablePath,
    };
  }

  if (plan.kind === 'needs-manual') {
    return {
      success: false,
      plan,
      error: plan.message,
    };
  }

  try {
    await execFileAsync(options.nodePath || process.execPath, [plan.scriptPath, plan.targetId], {
      cwd: options.projectRoot,
      env: {
        ...process.env,
        LLAMACPP_SRC: options.sourceDir,
        ...(options.cmakePath ? { CMAKE_BIN: options.cmakePath } : {}),
      },
      timeout: 30 * 60 * 1000,
      maxBuffer: 1024 * 1024 * 20,
    });
  } catch (error) {
    return {
      success: false,
      plan,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  try {
    if (options.syncRuntimeCurrent) {
      await options.syncRuntimeCurrent(plan.targetId);
    } else {
      await syncLlamaCppRuntimeCurrent(options.projectRoot, plan.targetId);
    }
  } catch (error) {
    return {
      success: false,
      plan,
      error: `llama.cpp runtime build finished, but vendor/llamacpp-runtime/current could not be synced: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const executablePath = await options.findExecutable();
  if (!executablePath) {
    return {
      success: false,
      plan,
      error: 'llama.cpp runtime build finished, but llama-server was not found in vendor/llamacpp-runtime/current.',
    };
  }

  return {
    success: true,
    plan,
    executablePath,
  };
}

export async function ensureLlamaCppRuntimeCurrent(
  projectRoot: string,
  targetId: string,
  platform: NodeJS.Platform = process.platform,
): Promise<string | null> {
  const currentExecutablePath = resolveLlamaCppRuntimeExecutablePath(projectRoot, 'current', platform);
  if (fs.existsSync(currentExecutablePath)) return currentExecutablePath;

  const targetExecutablePath = resolveLlamaCppRuntimeExecutablePath(projectRoot, targetId, platform);
  if (!fs.existsSync(targetExecutablePath)) return null;

  await syncLlamaCppRuntimeCurrent(projectRoot, targetId);
  return fs.existsSync(currentExecutablePath) ? currentExecutablePath : null;
}

export async function syncLlamaCppRuntimeCurrent(projectRoot: string, targetId: string): Promise<void> {
  const runtimeBaseDir = path.join(projectRoot, 'vendor', 'llamacpp-runtime');
  const targetRuntimeDir = path.join(runtimeBaseDir, targetId);
  const currentRuntimeDir = path.join(runtimeBaseDir, 'current');

  if (!fs.existsSync(targetRuntimeDir)) {
    throw new Error(`Target runtime does not exist: ${targetRuntimeDir}`);
  }

  try {
    const stat = fs.lstatSync(currentRuntimeDir);
    if (stat.isSymbolicLink()) {
      fs.unlinkSync(currentRuntimeDir);
    } else {
      fs.rmSync(currentRuntimeDir, { recursive: true, force: true });
    }
  } catch {
    // Missing current runtime is the normal repair path.
  }

  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  fs.symlinkSync(targetRuntimeDir, currentRuntimeDir, linkType);
}

export function resolveLlamaCppRuntimeExecutablePath(
  projectRoot: string,
  runtimeId: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return path.join(projectRoot, 'vendor', 'llamacpp-runtime', runtimeId, 'bin', resolveLlamaCppExecutableName(platform));
}

export async function ensureCMakeDependency(): Promise<CMakeDependencyInstallResult> {
  const existingPath = await findCMakePath();
  if (existingPath) {
    return {
      success: true,
      cmakePath: existingPath,
    };
  }

  const plan = await createCMakeDependencyInstallPlan(process.platform);
  if (plan.kind === 'needs-manual') {
    return {
      success: false,
      plan,
      error: plan.message,
    };
  }

  try {
    await execFileAsync(plan.command, plan.args, {
      timeout: 30 * 60 * 1000,
      maxBuffer: 1024 * 1024 * 20,
      env: {
        ...process.env,
        PATH: withCommonToolPaths(process.env.PATH),
      },
    });
  } catch (error) {
    return {
      success: false,
      plan,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const cmakePath = await findCMakePath();
  if (!cmakePath) {
    return {
      success: false,
      plan,
      error: 'CMake installation finished, but cmake was still not found. Restart the app or set CMAKE_BIN to the cmake executable path.',
    };
  }

  return {
    success: true,
    cmakePath,
    plan,
  };
}

export async function createCMakeDependencyInstallPlan(platform: NodeJS.Platform): Promise<CMakeDependencyInstallPlan> {
  if (platform === 'darwin') {
    const brewPath = await findCommandPath('brew', ['/opt/homebrew/bin/brew', '/usr/local/bin/brew']);
    if (!brewPath) {
      return {
        kind: 'needs-manual',
        message: 'CMake is required to build llama.cpp runtime, but Homebrew was not found. Install Homebrew and CMake, or set CMAKE_BIN to the cmake executable path.',
      };
    }
    return {
      kind: 'install',
      command: brewPath,
      args: ['install', 'cmake'],
      message: 'Installing CMake with Homebrew.',
    };
  }

  if (platform === 'win32') {
    const wingetPath = await findCommandPath('winget');
    if (wingetPath) {
      return {
        kind: 'install',
        command: wingetPath,
        args: ['install', '--id', 'Kitware.CMake', '--exact', '--silent', '--accept-package-agreements', '--accept-source-agreements'],
        message: 'Installing CMake with winget.',
      };
    }

    const chocoPath = await findCommandPath('choco');
    if (chocoPath) {
      return {
        kind: 'install',
        command: chocoPath,
        args: ['install', 'cmake', '-y'],
        message: 'Installing CMake with Chocolatey.',
      };
    }

    const scoopPath = await findCommandPath('scoop');
    if (scoopPath) {
      return {
        kind: 'install',
        command: scoopPath,
        args: ['install', 'cmake'],
        message: 'Installing CMake with Scoop.',
      };
    }

    return {
      kind: 'needs-manual',
      message: 'CMake is required to build llama.cpp runtime, but winget, Chocolatey, and Scoop were not found. Install CMake and restart the app.',
    };
  }

  if (platform === 'linux') {
    const root = typeof process.getuid === 'function' && process.getuid() === 0;
    const privilegePrefix = root ? null : await findLinuxPrivilegeCommand();
    const installer = await findLinuxCMakeInstaller();
    if (!installer) {
      return {
        kind: 'needs-manual',
        message: 'CMake is required to build llama.cpp runtime, but no supported Linux package manager was found. Install cmake with your distribution package manager.',
      };
    }

    if (!root && !privilegePrefix) {
      return {
        kind: 'needs-manual',
        message: `CMake is required to build llama.cpp runtime. Run ${installer.commandLine} with administrator privileges, then restart the app.`,
      };
    }

    if (root) {
      return {
        kind: 'install',
        command: installer.command,
        args: installer.args,
        message: `Installing CMake with ${installer.name}.`,
      };
    }

    return {
      kind: 'install',
      command: privilegePrefix.command,
      args: [...privilegePrefix.args, installer.command, ...installer.args],
      message: `Installing CMake with ${privilegePrefix.name} and ${installer.name}.`,
    };
  }

  return {
    kind: 'needs-manual',
    message: `CMake is required to build llama.cpp runtime, but automatic CMake installation is not supported on ${platform}.`,
  };
}

export function resolveDefaultLlamaCppSourceDir(): string {
  return process.env.LLAMACPP_SRC?.trim() || '/Users/whz/Desktop/rongx/llama.cpp';
}

export function getProjectRoot(): string {
  return process.cwd();
}

export function pathExists(candidate: string): boolean {
  return fs.existsSync(candidate);
}

export async function findCommandPath(command: string, extraCandidates: string[] = []): Promise<string | null> {
  const envPath = process.env[`${command.toUpperCase()}_BIN`]?.trim();
  if (envPath && fs.existsSync(envPath)) return envPath;

  for (const candidate of extraCandidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  const lookup = process.platform === 'win32' ? 'where' : 'which';
  try {
    const { stdout } = await execFileAsync(lookup, [command], {
      timeout: 1000,
      env: {
        ...process.env,
        PATH: withCommonToolPaths(process.env.PATH),
      },
    });
    return stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || null;
  } catch {
    return null;
  }
}

export async function findCMakePath(): Promise<string | null> {
  return await findCommandPath('cmake', [
    '/opt/homebrew/bin/cmake',
    '/usr/local/bin/cmake',
    '/Applications/CMake.app/Contents/bin/cmake',
  ]);
}

export async function findNodePath(): Promise<string | null> {
  return await findCommandPath('node', [
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
    '/usr/bin/node',
  ]);
}

function withCommonToolPaths(originalPath: string | undefined): string {
  const commonPaths = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ];
  const existingPaths = (originalPath ?? '').split(path.delimiter).filter(Boolean);
  return [...new Set([...existingPaths, ...commonPaths])].join(path.delimiter);
}

async function findLinuxPrivilegeCommand(): Promise<{ name: string; command: string; args: string[] } | null> {
  const pkexecPath = await findCommandPath('pkexec');
  if (pkexecPath) return { name: 'pkexec', command: pkexecPath, args: [] };

  const sudoPath = await findCommandPath('sudo');
  if (sudoPath) return { name: 'sudo', command: sudoPath, args: ['-n'] };

  return null;
}

async function findLinuxCMakeInstaller(): Promise<{
  name: string;
  command: string;
  args: string[];
  commandLine: string;
} | null> {
  const aptGetPath = await findCommandPath('apt-get');
  if (aptGetPath) {
    return {
      name: 'apt-get',
      command: aptGetPath,
      args: ['install', '-y', 'cmake'],
      commandLine: 'apt-get install -y cmake',
    };
  }

  const dnfPath = await findCommandPath('dnf');
  if (dnfPath) {
    return {
      name: 'dnf',
      command: dnfPath,
      args: ['install', '-y', 'cmake'],
      commandLine: 'dnf install -y cmake',
    };
  }

  const yumPath = await findCommandPath('yum');
  if (yumPath) {
    return {
      name: 'yum',
      command: yumPath,
      args: ['install', '-y', 'cmake'],
      commandLine: 'yum install -y cmake',
    };
  }

  const pacmanPath = await findCommandPath('pacman');
  if (pacmanPath) {
    return {
      name: 'pacman',
      command: pacmanPath,
      args: ['-S', '--noconfirm', 'cmake'],
      commandLine: 'pacman -S --noconfirm cmake',
    };
  }

  const zypperPath = await findCommandPath('zypper');
  if (zypperPath) {
    return {
      name: 'zypper',
      command: zypperPath,
      args: ['--non-interactive', 'install', 'cmake'],
      commandLine: 'zypper --non-interactive install cmake',
    };
  }

  const apkPath = await findCommandPath('apk');
  if (apkPath) {
    return {
      name: 'apk',
      command: apkPath,
      args: ['add', 'cmake'],
      commandLine: 'apk add cmake',
    };
  }

  return null;
}
