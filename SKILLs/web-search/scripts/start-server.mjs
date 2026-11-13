#!/usr/bin/env node
/**
 * Start Web Search Bridge Server (cross-platform Node.js).
 */

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_DIR = path.dirname(__dirname);
const PID_FILE = path.join(PROJECT_DIR, '.server.pid');
const LOG_FILE = path.join(PROJECT_DIR, '.server.log');
const SERVER_ENTRY = path.join(PROJECT_DIR, 'dist', 'server', 'index.js');
const FORCE_REPAIR = process.env.WEB_SEARCH_FORCE_REPAIR === '1';
const SERVER_PORT = 8923;
const DEFAULT_SERVER_URL = 'http://127.0.0.1:8923';
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

function isProcessRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error && typeof error === 'object' && error.code === 'EPERM';
  }
}

async function isBridgeServerHealthyAt(baseUrl) {
  const url = `${baseUrl.replace(/\/$/, '')}/api/health`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return false;
    const text = await response.text();
    return text.includes('"success":true');
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
  if (!fs.existsSync(SERVER_ENTRY)) return true;

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
      } else if (entry.isFile() && entry.name.endsWith('.ts')) {
        if (fs.statSync(fullPath).mtimeMs > distMtimeMs) {
          return true;
        }
      }
    }
  }
  return false;
}

function findListeningPidsOnPort(port) {
  try {
    if (process.platform === 'win32') {
      const output = execFileSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8' });
      const pids = new Set();
      for (const line of output.split(/\r?\n/)) {
        if (!line.includes('LISTENING')) continue;
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 5 && parts[1]?.endsWith(`:${port}`)) {
          const pid = Number.parseInt(parts[4], 10);
          if (Number.isInteger(pid) && pid > 0) pids.add(pid);
        }
      }
      return [...pids];
    }
    const output = execFileSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
    });
    return output
      .split(/\s+/)
      .map((item) => Number.parseInt(item, 10))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    return [];
  }
}

async function killListenersOnServerPort() {
  const pids = findListeningPidsOnPort(SERVER_PORT);
  if (pids.length === 0) return;

  console.log(`Force-repair enabled, stopping listeners on port ${SERVER_PORT}: ${pids.join(' ')}`);
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Ignore already exited processes.
    }
  }
  await sleep(1000);
  for (const pid of pids) {
    if (isProcessRunning(pid)) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Ignore already exited processes.
      }
    }
  }
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

  if (fs.existsSync(PID_FILE)) {
    const existingPid = Number.parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
    if (isProcessRunning(existingPid)) {
      if (FORCE_REPAIR) {
        console.log(`Force-repair enabled, stopping existing Bridge Server (PID: ${existingPid})...`);
        try {
          process.kill(existingPid, 'SIGTERM');
        } catch {
          // Ignore
        }
        await sleep(1000);
        if (isProcessRunning(existingPid)) {
          try {
            process.kill(existingPid, 'SIGKILL');
          } catch {
            // Ignore
          }
        }
        fs.rmSync(PID_FILE, { force: true });
      } else {
        console.log(`✓ Bridge Server is already running (PID: ${existingPid})`);
        return 0;
      }
    } else {
      fs.rmSync(PID_FILE, { force: true });
    }
  }

  if (FORCE_REPAIR) {
    await killListenersOnServerPort();
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
    if (!ensureNpmAvailable()) return 1;
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

  if (!child.pid) {
    console.error('✗ Failed to spawn Bridge Server process');
    return 1;
  }

  fs.writeFileSync(PID_FILE, `${child.pid}\n`, 'utf8');
  child.unref();

  await sleep(2000);

  if (isProcessRunning(child.pid)) {
    console.log(`✓ Bridge Server started successfully (PID: ${child.pid})`);
    console.log(`  Health check: ${DEFAULT_SERVER_URL}/api/health`);
    if (SERVER_URL !== DEFAULT_SERVER_URL) {
      console.log(`  Requested endpoint: ${SERVER_URL.replace(/\/$/, '')}/api/health`);
    }
    console.log(`  Logs: ${LOG_FILE}`);
    return 0;
  }

  const healthyUrl = await detectHealthyBridgeServer();
  if (healthyUrl) {
    console.log(
      `✓ Bridge Server is already running (detected via health endpoint: ${healthyUrl.replace(/\/$/, '')}/api/health)`,
    );
    fs.rmSync(PID_FILE, { force: true });
    return 0;
  }

  console.error('✗ Failed to start Bridge Server');
  console.error(`  Check logs: ${LOG_FILE}`);
  fs.rmSync(PID_FILE, { force: true });
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
