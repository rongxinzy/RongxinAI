import extractZip from 'extract-zip';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as tar from 'tar';

import type {
  LlamaCppRuntimeInstallPlan,
  LlamaCppRuntimeInstallResult,
} from '../../shared/llamacpp';

const LLAMACPP_RUNTIME_GITHUB_REPO = 'ggml-org/llama.cpp';
const LLAMACPP_RUNTIME_RELEASE_TAG = 'b9244';
const LLAMACPP_RUNTIME_DEFAULT_RELEASES_URL =
  'https://gitee.com/wanghaozhe1106/llama.cpp-runtime/releases/download';
const LLAMACPP_RUNTIME_ASSETS: Record<string, string> = {
  'mac-arm64': 'llama-{tag}-bin-macos-arm64.tar.gz',
  'mac-x64': 'llama-{tag}-bin-macos-x64.tar.gz',
  'win-x64': 'llama-{tag}-bin-win-cpu-x64.zip',
  'win-arm64': 'llama-{tag}-bin-win-cpu-arm64.zip',
  'linux-x64': 'llama-{tag}-bin-ubuntu-x64.tar.gz',
  'linux-arm64': 'llama-{tag}-bin-ubuntu-arm64.tar.gz',
};

export type LlamaCppRuntimeInstallContext = {
  platform: NodeJS.Platform;
  arch: string;
  isPackaged: boolean;
  existingExecutablePath: string | null;
  userRuntimeRoot?: string;
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

export function resolveLlamaCppRuntimeAssetName(targetId: string): string {
  const template = LLAMACPP_RUNTIME_ASSETS[targetId];
  if (!template) throw new Error(`Unsupported prebuilt llama.cpp runtime target: ${targetId}`);
  return template.replace(/\{tag\}/g, LLAMACPP_RUNTIME_RELEASE_TAG);
}

export function resolveLlamaCppRuntimeDownloadUrl(
  targetId: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolveLlamaCppRuntimeDownloadUrls(targetId, env)[0];
}

export function resolveLlamaCppRuntimeDownloadUrls(
  targetId: string,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const assetName = resolveLlamaCppRuntimeAssetName(targetId);
  const explicitUrl = env.LLAMACPP_RUNTIME_URL?.trim();
  if (explicitUrl) {
    return [explicitUrl.replace(/\{target\}/g, targetId).replace(/\{asset\}/g, assetName)];
  }
  const baseUrl = env.LLAMACPP_RUNTIME_BASE_URL?.trim();
  if (baseUrl) {
    return [`${baseUrl.replace(/\/$/, '')}/${assetName}`];
  }
  return [
    `${LLAMACPP_RUNTIME_DEFAULT_RELEASES_URL}/${LLAMACPP_RUNTIME_RELEASE_TAG}/${assetName}`,
    `https://github.com/${LLAMACPP_RUNTIME_GITHUB_REPO}/releases/download/${LLAMACPP_RUNTIME_RELEASE_TAG}/${assetName}`,
  ];
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
      message: `Unsupported platform for llama.cpp runtime: ${context.platform}/${context.arch}.`,
    };
  }

  if (context.isPackaged) {
    if (!context.userRuntimeRoot) {
      return {
        kind: 'needs-manual',
        message: 'The app could not resolve the local llama.cpp runtime install directory.',
      };
    }
    const [url, ...fallbackUrls] = resolveLlamaCppRuntimeDownloadUrls(targetId);
    return {
      kind: 'download',
      targetId,
      runtimeRoot: context.userRuntimeRoot,
      executablePath: path.join(
        context.userRuntimeRoot,
        'current',
        'bin',
        resolveLlamaCppExecutableName(context.platform),
      ),
      url,
      fallbackUrls,
    };
  }

  return {
    kind: 'needs-manual',
    message: `The prebuilt llama.cpp runtime is missing. Run npm run llamacpp:runtime:download -- ${targetId} before starting the app. If the download returns 404, the published release asset is missing and you must either set LLAMACPP_RUNTIME_URL / LLAMACPP_RUNTIME_BASE_URL, build locally with npm run llamacpp:runtime:${targetId}, or set LLAMACPP_BIN to a prebuilt llama-server executable.`,
  };
}

export async function executeLlamaCppRuntimeInstallPlan(
  plan: LlamaCppRuntimeInstallPlan,
): Promise<LlamaCppRuntimeInstallResult> {
  if (plan.kind === 'ready') {
    return {
      success: true,
      plan,
      executablePath: plan.executablePath,
    };
  }

  if (plan.kind === 'download') {
    try {
      await installDownloadedRuntime(plan);
      return {
        success: true,
        plan,
        executablePath: plan.executablePath,
      };
    } catch (error) {
      return {
        success: false,
        plan,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  if (plan.kind === 'needs-manual') {
    return {
      success: false,
      plan,
      error: plan.message,
    };
  }
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

export function getProjectRoot(): string {
  return process.cwd();
}

async function installDownloadedRuntime(plan: Extract<LlamaCppRuntimeInstallPlan, { kind: 'download' }>): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llamacpp-runtime-'));
  const archiveName = path.basename(new URL(plan.url).pathname) || resolveLlamaCppRuntimeAssetName(plan.targetId);
  const archivePath = path.join(tempDir, archiveName);
  const extractDir = path.join(tempDir, 'extract');
  const executableName = path.basename(plan.executablePath);

  try {
    const sourceUrl = await downloadFile(plan.url, archivePath, plan.fallbackUrls);
    fs.mkdirSync(extractDir, { recursive: true });
    await extractArchive(archivePath, extractDir);

    const extractedExecutable = findExecutablePath(extractDir, executableName);
    if (!extractedExecutable) {
      throw new Error(`Downloaded llama.cpp runtime archive does not contain ${executableName}.`);
    }

    const currentRuntimeRoot = path.join(plan.runtimeRoot, 'current');
    const targetBinDir = path.join(currentRuntimeRoot, 'bin');
    fs.rmSync(currentRuntimeRoot, { recursive: true, force: true });
    fs.mkdirSync(targetBinDir, { recursive: true });
    copyDirectoryContents(path.dirname(extractedExecutable), targetBinDir);
    writeRuntimeBuildInfo(currentRuntimeRoot, { ...plan, url: sourceUrl }, archiveName);

    if (!fs.existsSync(plan.executablePath)) {
      throw new Error(`Installed llama.cpp runtime is missing ${path.join('bin', executableName)}.`);
    }
    if (process.platform !== 'win32') {
      fs.chmodSync(plan.executablePath, 0o755);
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function downloadFile(url: string, outputPath: string, fallbackUrls: string[] = []): Promise<string> {
  const attempts = [url, ...fallbackUrls];
  const errors: string[] = [];

  for (const attemptUrl of attempts) {
    const response = await fetch(attemptUrl, {
      headers: { 'User-Agent': 'RongxinAI/llamacpp-runtime-installer' },
    });
    if (!response.ok || !response.body) {
      errors.push(`HTTP ${response.status} ${response.statusText} (${attemptUrl})`);
      continue;
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const arrayBuffer = await response.arrayBuffer();
    fs.writeFileSync(outputPath, Buffer.from(arrayBuffer));
    return attemptUrl;
  }

  throw new Error(`Download failed: ${errors.join('; ')}`);
}

async function extractArchive(archivePath: string, extractDir: string): Promise<void> {
  if (archivePath.endsWith('.zip')) {
    await extractZip(archivePath, { dir: extractDir });
    return;
  }
  if (archivePath.endsWith('.tar.gz')) {
    await tar.x({ file: archivePath, cwd: extractDir });
    return;
  }
  throw new Error(`Unsupported llama.cpp runtime archive format: ${archivePath}`);
}

export function copyDirectoryContents(sourceDir: string, targetDir: string): void {
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(targetPath, { recursive: true });
      copyDirectoryContents(sourcePath, targetPath);
      continue;
    }
    fs.copyFileSync(sourcePath, targetPath);
  }
}

function findExecutablePath(rootDir: string, executableName: string): string | null {
  const queue = [rootDir];
  while (queue.length > 0) {
    const currentDir = queue.shift();
    if (!currentDir) continue;
    const directExecutable = path.join(currentDir, executableName);
    if (fs.existsSync(directExecutable)) return directExecutable;
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      if (entry.isDirectory()) queue.push(path.join(currentDir, entry.name));
    }
  }
  return null;
}

function writeRuntimeBuildInfo(
  runtimeRoot: string,
  plan: Extract<LlamaCppRuntimeInstallPlan, { kind: 'download' }>,
  archiveName: string,
): void {
  fs.writeFileSync(
    path.join(runtimeRoot, 'runtime-build-info.json'),
    JSON.stringify({
      target: plan.targetId,
      version: LLAMACPP_RUNTIME_RELEASE_TAG,
      source: 'official-release',
      sourceUrl: plan.url,
      assetName: archiveName,
      installedAt: new Date().toISOString(),
    }, null, 2) + '\n',
    'utf8',
  );
}
