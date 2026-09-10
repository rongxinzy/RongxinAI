import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { session } from 'electron';
import extractZip from 'extract-zip';

import { getFeishuCliBinDirectory } from './feishuConnectorPaths';

const FEISHU_CLI_VERSION = '1.0.93';
const FEISHU_CLI_NAME = 'lark-cli';
const DOWNLOAD_TIMEOUT_MS = 120_000;

const archiveChecksums = {
  'darwin-x64': 'bf37861ce5b5fb10c093ffd8b7305f2a80349280cf32563267c29f81cb864e53',
  'darwin-arm64': 'eaa09754925c00a6858e91518a49ab8e0a24bd4178e4698a7b185046b8ea24e2',
  'linux-x64': '10031849a1884bf9165cb01de47102b4847fba81bb9eb76f4168125ea9746c51',
  'linux-arm64': '800832bb84b0bf74579f49de3219b2ea8b9e72049c5a3ed239680e4cbc31474c',
  'win32-x64': '18e9320e378a0eefdb3b7004e0c6d42f48da85ae196d2bf5e89e4299ae7674d7',
  'win32-arm64': '3739889cab8d938bbe2015032cd3e8de82ba0608b01e6b3ce3740f999199b4fb',
} as const;

type FeishuCliTarget = keyof typeof archiveChecksums;

const platformNames = { darwin: 'darwin', linux: 'linux', win32: 'windows' } as const;
const architectureNames = { x64: 'amd64', arm64: 'arm64' } as const;

function getTarget(): FeishuCliTarget {
  const target = `${process.platform}-${process.arch}`;
  if (!(target in archiveChecksums)) {
    throw new Error(`Feishu CLI does not support ${target}.`);
  }
  return target as FeishuCliTarget;
}

function getArchiveName(target: FeishuCliTarget): string {
  const [platform, architecture] = target.split('-') as [keyof typeof platformNames, keyof typeof architectureNames];
  const extension = platform === 'win32' ? 'zip' : 'tar.gz';
  return `${FEISHU_CLI_NAME}-${FEISHU_CLI_VERSION}-${platformNames[platform]}-${architectureNames[architecture]}.${extension}`;
}

function getDownloadUrls(archiveName: string): string[] {
  return [
    `https://github.com/larksuite/cli/releases/download/v${FEISHU_CLI_VERSION}/${archiveName}`,
    `https://registry.npmmirror.com/-/binary/lark-cli/v${FEISHU_CLI_VERSION}/${archiveName}`,
  ];
}

async function downloadArchive(urls: string[], archivePath: string): Promise<void> {
  let lastError: unknown;
  for (const url of urls) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    try {
      const response = await session.defaultSession.fetch(url, {
        headers: { 'User-Agent': 'ZhiYuan Agent Feishu CLI Installer' },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      await fs.promises.writeFile(archivePath, Buffer.from(await response.arrayBuffer()));
      return;
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`Feishu CLI download failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const input = fs.createReadStream(filePath);
    input.on('data', chunk => hash.update(chunk));
    input.once('error', reject);
    input.once('end', () => resolve(hash.digest('hex')));
  });
}

async function extractArchive(archivePath: string, target: FeishuCliTarget, destination: string): Promise<void> {
  if (target.startsWith('win32-')) {
    await extractZip(archivePath, { dir: destination });
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn('tar', ['-xzf', archivePath, '-C', destination], { windowsHide: true });
    child.once('error', reject);
    child.once('close', code => (code === 0 ? resolve() : reject(new Error(`tar exited with ${code ?? 'unknown'}`))));
  });
}

export async function installDownloadedFeishuCli(userDataPath: string): Promise<void> {
  const target = getTarget();
  const archiveName = getArchiveName(target);
  const temporaryRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'zhiyuan-feishu-cli-'));
  const cliBinDirectory = getFeishuCliBinDirectory(userDataPath);
  const stagedBinDirectory = `${cliBinDirectory}.staging-${process.pid}-${Date.now()}`;
  const backupBinDirectory = `${cliBinDirectory}.backup-${process.pid}-${Date.now()}`;
  try {
    const archivePath = path.join(temporaryRoot, archiveName);
    await downloadArchive(getDownloadUrls(archiveName), archivePath);
    const expectedHash = archiveChecksums[target];
    if ((await sha256File(archivePath)) !== expectedHash) throw new Error('Feishu CLI download checksum mismatch.');
    await fs.promises.mkdir(stagedBinDirectory, { recursive: true });
    await extractArchive(archivePath, target, stagedBinDirectory);
    const binaryName = process.platform === 'win32' ? `${FEISHU_CLI_NAME}.exe` : FEISHU_CLI_NAME;
    await fs.promises.access(path.join(stagedBinDirectory, binaryName));
    try {
      await fs.promises.rename(cliBinDirectory, backupBinDirectory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await fs.promises.rename(stagedBinDirectory, cliBinDirectory);
    await fs.promises.rm(backupBinDirectory, { recursive: true, force: true });
  } finally {
    await fs.promises.rm(stagedBinDirectory, { recursive: true, force: true });
    await fs.promises.rm(temporaryRoot, { recursive: true, force: true });
  }
}
