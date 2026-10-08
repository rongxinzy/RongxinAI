import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

const filePath = path.join(os.tmpdir(), `zhiyuan-update-hash-${process.pid}.bin`);
const workerPath = path.resolve('dist-electron/appUpdateHashWorker.js');
const bytes = 128 * 1024 * 1024;

async function measure(label, operation) {
  let maxDelay = 0;
  let expected = performance.now() + 10;
  const timer = setInterval(() => {
    const now = performance.now();
    maxDelay = Math.max(maxDelay, Math.max(0, now - expected));
    expected = now + 10;
  }, 10);
  const started = performance.now();
  try {
    const digest = await operation();
    return {
      label,
      elapsedMs: Math.round(performance.now() - started),
      maxTimerDelayMs: Math.round(maxDelay),
      digest,
    };
  } finally {
    clearInterval(timer);
  }
}

async function hashOnMain() {
  const hash = crypto.createHash('sha512');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('base64');
}

function hashInWorker() {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath);
    worker.once('message', result => {
      void worker.terminate();
      if (result.error || !result.digest) reject(new Error(result.error || 'No worker digest'));
      else resolve(result.digest);
    });
    worker.once('error', reject);
    worker.postMessage({ filePath });
  });
}

try {
  if (!fs.existsSync(workerPath))
    throw new Error('Build the Electron app before running this benchmark');
  fs.writeFileSync(filePath, Buffer.alloc(1024 * 1024));
  fs.truncateSync(filePath, bytes);
  const baseline = await measure('main', hashOnMain);
  const worker = await measure('worker', hashInWorker);
  if (baseline.digest !== worker.digest) throw new Error('Worker digest differs from the baseline');
  console.log(JSON.stringify({ bytes, baseline, worker }, null, 2));
} finally {
  fs.rmSync(filePath, { force: true });
}
