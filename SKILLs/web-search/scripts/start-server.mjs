#!/usr/bin/env node
/**
 * Start Web Search Bridge Server (cross-platform Node.js).
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SERVER_URL, stopStandaloneBridge } from '../server/standaloneControl.cjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_DIR = path.dirname(__dirname);
const LOG_FILE = path.join(PROJECT_DIR, '.server.log');
const SERVER_ENTRY = path.join(PROJECT_DIR, 'dist', 'server', 'index.js');
const LOCAL_COMPILER = path.join(PROJECT_DIR, 'node_modules', 'typescript', 'bin', 'tsc');
const FORCE_REPAIR = process.env.WEB_SEARCH_FORCE_REPAIR === '1';
const SERVER_PORT = Number(new URL(DEFAULT_SERVER_URL).port);
const SERVER_URL = process.env.WEB_SEARCH_SERVER || DEFAULT_SERVER_URL;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getNodeRuntime() {
  const electronPath = process.env.ZHIYUAN_ELECTRON_PATH?.trim();
  if (process.versions.electron || electronPath) {
    const cmd = process.versions.electron ? process.execPath : electronPath;
    if (cmd && fs.existsSync(cmd)) {
      return {
        command: cmd,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      };
    }
  }
  return {
    command: process.execPath,
    env: { ...process.env },
  };
}

async function isBridgeServerHealthyAt(baseUrl) {
  const url = `${baseUrl.replace(/\/$/, '')}/api/health`;
  try {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(1200) });
    if (!response.ok) return false;
    const health = await response.json();
    return health.success === true && health.data?.status === 'healthy';
  } catch {
    return false;
  }
}

async function detectHealthyBridgeServer() {
  const candidates = [SERVER_URL];
  if (SERVER_URL !== DEFAULT_SERVER_URL) {
    candidates.push(DEFAULT_SERVER_URL);
  }
  for (const candidate of candidates) {
    if (await isBridgeServerHealthyAt(candidate)) {
      return candidate;
    }
  }
  return null;
}

function getNpmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function ensureNpmAvailable() {
  const check = spawnSync(getNpmCommand(), ['--version'], { stdio: 'ignore' });
  if (check.status === 0) return true;
  console.error('✗ npm is unavailable, cannot repair web-search runtime');
  console.error('  Please reinstall the web-search skill runtime from ZhiYuanAgent.');
  return false;
}

function installDependencies() {
  console.log('Installing dependencies...');
  const result = spawnSync(getNpmCommand(), ['install'], {
    cwd: PROJECT_DIR,
    stdio: 'ignore',
  });
  if (result.status !== 0) {
    console.error('✗ Failed to install dependencies');
    console.error('  Check network access and npm logs, then retry.');
    return false;
  }
  return true;
}

function repairIconvLite() {
  console.log('Repairing incomplete iconv-lite installation...');
  fs.rmSync(path.join(PROJECT_DIR, 'node_modules', 'iconv-lite'), { recursive: true, force: true });
  const result = spawnSync(getNpmCommand(), ['install', '--no-save', 'iconv-lite'], {
    cwd: PROJECT_DIR,
    stdio: 'ignore',
  });
  if (result.status !== 0) {
    console.error('✗ Failed to repair iconv-lite dependency');
    return false;
  }
  return true;
}

function verifyIconvRuntime(runtime) {
  const res = spawnSync(
    runtime.command,
    ['-e', "require('./node_modules/iconv-lite/lib/index.js')"],
    { cwd: PROJECT_DIR, env: runtime.env, stdio: 'ignore' },
  );
  return res.status === 0;
}

function isServerBuildOutdated() {
  if (
    !fs.existsSync(SERVER_ENTRY) ||
    !fs.existsSync(path.join(path.dirname(SERVER_ENTRY), 'standaloneControl.cjs'))
  ) return true;

  let distMtimeMs = 0;
  try {
    distMtimeMs = fs.statSync(SERVER_ENTRY).mtimeMs;
    const entryText = fs.readFileSync(SERVER_ENTRY, 'utf8');
    if (entryText.includes('function scoreDecodedJsonText')) {
      return true;
    }
  } catch {
    return true;
  }

  if (!fs.existsSync(LOCAL_COMPILER)) return false;
  const serverDir = path.join(PROJECT_DIR, 'server');
  if (!fs.existsSync(serverDir)) return false;

  const stack = [serverDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && /\.(ts|cjs)$/.test(entry.name)) {
        if (fs.statSync(fullPath).mtimeMs > distMtimeMs) {
          return true;
        }
      }
    }
  }
  return false;
}

function localPortAvailable() {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port: SERVER_PORT });
    socket.setTimeout(1000, () => socket.destroy());
    socket.on('connect', () => socket.destroy());
    socket.on('error', error => resolve(error.code === 'ECONNREFUSED'));
    socket.on('close', () => resolve(false));
  });
}

async function main() {
  if (!FORCE_REPAIR) {
    const healthyUrl = await detectHealthyBridgeServer();
    if (healthyUrl) {
      console.log(
        `✓ Bridge Server is already running (detected via health endpoint: ${healthyUrl.replace(/\/$/, '')}/api/health)`,
      );
      return 0;
    }
  }

  if (FORCE_REPAIR) await stopStandaloneBridge(PROJECT_DIR);

  if (!(await localPortAvailable())) {
    console.error(`✗ Bridge Server port ${SERVER_PORT} is occupied. Stop the owning application before repairing the runtime.`);
    return 1;
  }

  console.log('Starting Bridge Server...');
  process.chdir(PROJECT_DIR);

  const runtime = getNodeRuntime();
  const iconvSentinel = path.join(PROJECT_DIR, 'node_modules', 'iconv-lite', 'encodings', 'index.js');

  if (FORCE_REPAIR) {
    if (!ensureNpmAvailable() || !repairIconvLite()) return 1;
  }

  if (!fs.existsSync(path.join(PROJECT_DIR, 'node_modules')) || !fs.existsSync(iconvSentinel)) {
    if (!ensureNpmAvailable() || !installDependencies()) return 1;
  }

  if (!fs.existsSync(iconvSentinel)) {
    if (!ensureNpmAvailable() || !repairIconvLite()) return 1;
  }

  if (!fs.existsSync(iconvSentinel)) {
    console.error('✗ Dependency check failed: missing node_modules/iconv-lite/encodings/index.js');
    console.error('  Try removing node_modules and reinstalling with network access.');
    return 1;
  }

  if (!verifyIconvRuntime(runtime)) {
    if (!ensureNpmAvailable() || !repairIconvLite()) return 1;
  }

  if (!verifyIconvRuntime(runtime)) {
    console.error('✗ iconv-lite runtime verification failed after repair');
    console.error('  Try removing node_modules and reinstalling with network access.');
    return 1;
  }

  if (isServerBuildOutdated()) {
    if (!ensureNpmAvailable() || (!fs.existsSync(LOCAL_COMPILER) && !installDependencies())) return 1;
    console.log('Compiling TypeScript (dist missing/outdated)...');
    const buildResult = spawnSync(getNpmCommand(), ['run', 'build'], {
      cwd: PROJECT_DIR,
      stdio: 'ignore',
    });
    if (buildResult.status !== 0) {
      console.error('✗ Failed to compile TypeScript server');
      return 1;
    }
  }

  const logFd = fs.openSync(LOG_FILE, 'w');
  const child = spawn(runtime.command, [SERVER_ENTRY], {
    cwd: PROJECT_DIR,
    env: runtime.env,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', logFd, logFd],
  });
  fs.closeSync(logFd);

  child.on('error', error => console.error('✗ Bridge Server process failed:', error.message));
  child.unref();

  const deadline = Date.now() + 5000;
  do {
    if (await isBridgeServerHealthyAt(DEFAULT_SERVER_URL)) {
      console.log(`✓ Bridge Server is healthy at ${DEFAULT_SERVER_URL}/api/health`);
      console.log(`  Logs: ${LOG_FILE}`);
      return 0;
    }
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) break;
    await sleep(150);
  } while (Date.now() < deadline);

  if (child.exitCode === null && child.signalCode === null) child.kill();
  console.error(`✗ Failed to start Bridge Server. Check logs: ${LOG_FILE}`);
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
