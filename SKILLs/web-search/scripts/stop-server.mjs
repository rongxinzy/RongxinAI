#!/usr/bin/env node
/**
 * Stop Web Search Bridge Server (cross-platform Node.js).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_DIR = path.dirname(__dirname);
const PID_FILE = path.join(PROJECT_DIR, '.server.pid');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isProcessRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error && typeof error === 'object' && error.code === 'EPERM';
  }
}

async function main() {
  if (!fs.existsSync(PID_FILE)) {
    console.log('✓ Bridge Server is not running');
    return 0;
  }

  const rawPid = fs.readFileSync(PID_FILE, 'utf8').trim();
  const pid = Number.parseInt(rawPid, 10);

  if (!isProcessRunning(pid)) {
    console.log('✓ Bridge Server is not running (stale PID file removed)');
    fs.rmSync(PID_FILE, { force: true });
    return 0;
  }

  console.log(`Stopping Bridge Server (PID: ${pid})...`);
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // Ignore errors if already exited.
  }

  for (let i = 0; i < 10; i += 1) {
    if (!isProcessRunning(pid)) {
      console.log('✓ Bridge Server stopped successfully');
      fs.rmSync(PID_FILE, { force: true });
      return 0;
    }
    await sleep(500);
  }

  if (isProcessRunning(pid)) {
    console.log('Force stopping Bridge Server...');
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Ignore errors if already exited.
    }
    await sleep(500);
  }

  if (isProcessRunning(pid)) {
    console.error('✗ Failed to stop Bridge Server');
    return 1;
  }

  console.log('✓ Bridge Server stopped (forced)');
  fs.rmSync(PID_FILE, { force: true });
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
