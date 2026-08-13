'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

function protocolHeaders(nonce) {
  return {
    authorization: 'Bearer smoke-secret',
    'x-zhiyuan-protocol-version': '1',
    'x-zhiyuan-request-id': crypto.randomUUID(),
    'x-zhiyuan-timestamp-ms': String(Date.now()),
    'x-zhiyuan-nonce': nonce,
  };
}

function listenLoopback(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Bridge server has no TCP address'));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) =>
    server.close(error => (error ? reject(error) : resolve())),
  );
}

function waitForTrigger(register) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Sidecar did not emit a cron trigger')), 5_000);
    register(trigger => {
      clearTimeout(timer);
      resolve(trigger);
    });
  });
}

async function waitForHealth(url, child, headers) {
  let lastError;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Channel runtime exited before health check with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(1_000) });
      if (response.ok) return response;
      lastError = new Error(`Health endpoint returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw lastError instanceof Error ? lastError : new Error('Channel runtime health timed out');
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    new Promise(resolve =>
      setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 2_000),
    ),
  ]);
}

async function main() {
  const rootDir = path.resolve(__dirname, '..');
  const binaryName = process.platform === 'win32' ? 'cc-connect-sidecar.exe' : 'cc-connect-sidecar';
  const runtimeRoot = path.join(rootDir, 'vendor', 'channel-runtime', 'current');
  let publishedBinary = binaryName;
  try {
    const buildInfo = JSON.parse(fs.readFileSync(path.join(runtimeRoot, 'runtime-build-info.json'), 'utf8'));
    if (typeof buildInfo.binary === 'string') publishedBinary = buildInfo.binary;
  } catch {}
  const executable = path.join(runtimeRoot, publishedBinary);
  if (!fs.existsSync(executable)) {
    throw new Error('Channel runtime is missing. Run `npm run channel:runtime:download` first.');
  }

  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-channel-smoke-'));
  let resolveTrigger = () => {};
  const bridgeServer = http.createServer((request, response) => {
    const token = request.headers.authorization;
    const version = request.headers['x-zhiyuan-protocol-version'];
    const timestamp = Number(request.headers['x-zhiyuan-timestamp-ms']);
    const nonce = request.headers['x-zhiyuan-nonce'];
    if (
      token !== 'Bearer smoke-secret' ||
      version !== '1' ||
      !Number.isFinite(timestamp) ||
      Math.abs(Date.now() - timestamp) > 5 * 60 * 1_000 ||
      typeof nonce !== 'string' ||
      !nonce
    ) {
      response.writeHead(401).end();
      return;
    }
    if (request.method !== 'POST' || request.url !== '/v1/cc-connect/cron/trigger') {
      response.writeHead(404).end();
      return;
    }
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      const trigger = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      response.writeHead(204).end();
      resolveTrigger(trigger);
    });
  });
  const bridgeUrl = await listenLoopback(bridgeServer);
  const configPath = path.join(temporaryRoot, 'config.toml');
  const config = [
    `data_dir = ${JSON.stringify(path.join(temporaryRoot, 'data'))}`,
    '',
    '[webhook]',
    'enabled = false',
    '',
    '[bridge]',
    'enabled = false',
    '',
    '[management]',
    'enabled = false',
    '',
    '[[projects]]',
    'name = "__zhiyuan_scheduler__"',
    '[projects.agent]',
    'type = "zhiyuan-bridge"',
    '[projects.agent.options]',
    `bridge_url = ${JSON.stringify(bridgeUrl)}`,
    'bridge_token = "smoke-secret"',
    'cron_control_listen = "127.0.0.1:0"',
    '',
  ].join('\n');
  fs.writeFileSync(configPath, config, 'utf8');

  const output = [];
  const child = spawn(executable, [], {
    env: { ...process.env, CC_CONNECT_CONFIG: configPath },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.on('data', chunk => output.push(String(chunk)));
  child.stderr.on('data', chunk => output.push(String(chunk)));

  try {
    const baseUrl = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Channel runtime did not announce its control URL')), 5_000);
      const inspect = chunk => {
        const match = String(chunk).match(/\burl=(http:\/\/[^\s]+)/);
        if (!match) return;
        clearTimeout(timer);
        resolve(match[1]);
      };
      child.stdout.on('data', inspect);
      child.stderr.on('data', inspect);
      child.once('exit', code => {
        clearTimeout(timer);
        reject(new Error(`Channel runtime exited before announcing control URL with code ${code}`));
      });
    });
    const healthUrl = `${baseUrl}/v1/cc-connect/cron/health`;
    const headers = protocolHeaders('smoke-nonce');
    const healthResponse = await waitForHealth(healthUrl, child, headers);
    const health = await healthResponse.json();
    if (
      health.protocolVersion !== '1' ||
      health.pid !== child.pid ||
      !Array.isArray(health.capabilities) ||
      !Array.isArray(health.platforms) ||
      !health.capabilities.includes('channel-transport') ||
      !health.capabilities.includes('delivery') ||
      !health.capabilities.includes('trigger-only-cron')
    ) {
      throw new Error(`Unexpected channel runtime health: ${JSON.stringify(health)}`);
    }

    const replay = await fetch(healthUrl, { headers, signal: AbortSignal.timeout(1_000) });
    if (replay.status !== 401) {
      throw new Error(`Replayed nonce returned HTTP ${replay.status}, expected 401`);
    }

    const triggerPromise = waitForTrigger(resolve => {
      resolveTrigger = resolve;
    });
    const registerResponse = await fetch(`${baseUrl}/v1/cc-connect/cron/tasks`, {
      method: 'POST',
      headers: {
        ...protocolHeaders('register-nonce'),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        accountId: '__zhiyuan_scheduler__',
        taskId: 'smoke-task',
        scheduleVersion: 'smoke-v1',
        schedule: { kind: 'every', everyMs: 250 },
      }),
      signal: AbortSignal.timeout(1_000),
    });
    if (registerResponse.status !== 204) {
      throw new Error(`Cron registration returned HTTP ${registerResponse.status}`);
    }
    const trigger = await triggerPromise;
    if (
      trigger.accountId !== '__zhiyuan_scheduler__' ||
      trigger.taskId !== 'smoke-task' ||
      trigger.scheduleVersion !== 'smoke-v1' ||
      Number.isNaN(Date.parse(trigger.scheduledAt))
    ) {
      throw new Error(`Unexpected cron trigger: ${JSON.stringify(trigger)}`);
    }

    const removeEveryResponse = await fetch(
      `${baseUrl}/v1/cc-connect/cron/tasks/smoke-task?accountId=__zhiyuan_scheduler__`,
      {
        method: 'DELETE',
        headers: protocolHeaders('remove-every-nonce'),
        signal: AbortSignal.timeout(1_000),
      },
    );
    if (removeEveryResponse.status !== 204) {
      throw new Error(`Cron removal returned HTTP ${removeEveryResponse.status}`);
    }

    const atTriggerPromise = waitForTrigger(resolve => {
      resolveTrigger = resolve;
    });
    const scheduledAt = new Date(Date.now() + 250).toISOString();
    const atResponse = await fetch(`${baseUrl}/v1/cc-connect/cron/tasks`, {
      method: 'POST',
      headers: {
        ...protocolHeaders('register-at-nonce'),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        accountId: '__zhiyuan_scheduler__',
        taskId: 'smoke-at-task',
        scheduleVersion: 'smoke-at-v1',
        schedule: { kind: 'at', at: scheduledAt },
      }),
      signal: AbortSignal.timeout(1_000),
    });
    if (atResponse.status !== 204) {
      throw new Error(`At registration returned HTTP ${atResponse.status}`);
    }
    const atTrigger = await atTriggerPromise;
    if (
      atTrigger.taskId !== 'smoke-at-task' ||
      atTrigger.scheduleVersion !== 'smoke-at-v1' ||
      Date.parse(atTrigger.scheduledAt) !== Date.parse(scheduledAt)
    ) {
      throw new Error(`Unexpected at trigger: ${JSON.stringify(atTrigger)}`);
    }
    console.log(
      `[ChannelRuntimeSmoke] Healthy PID ${child.pid}; capabilities: ${health.capabilities.join(', ')}; replay rejected; every and at triggers received.`,
    );
  } catch (error) {
    const logs = output.join('').trim();
    if (logs) console.error(`[ChannelRuntimeSmoke] Sidecar output:\n${logs}`);
    throw error;
  } finally {
    await stopChild(child);
    await closeServer(bridgeServer);
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(`[ChannelRuntimeSmoke] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
