#!/usr/bin/env node
/**
 * Web Search CLI (cross-platform Node.js).
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_DIR = path.dirname(__dirname);
const DEFAULT_SERVER_URL = 'http://127.0.0.1:8923';
let ACTIVE_SERVER_URL = process.env.WEB_SEARCH_SERVER || DEFAULT_SERVER_URL;
const CONNECTION_CACHE = path.join(PROJECT_DIR, '.connection');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getChildRuntimeEnv(extra = {}) {
  return {
    ...process.env,
    ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
    ...extra,
  };
}

function runHelperScript(scriptName, args = [], extraEnv = {}) {
  return spawnSync(process.execPath, [path.join(__dirname, scriptName), ...args], {
    cwd: PROJECT_DIR,
    env: getChildRuntimeEnv(extraEnv),
    stdio: 'ignore',
  });
}

function usage() {
  const name = path.basename(process.argv[1] || 'search.mjs');
  console.error(`Usage: ${name} <query|@query_file> [max_results]

Arguments:
  query         Search query (required), or @UTF-8-file-path for non-ASCII
  max_results   Maximum number of results (default: 10)

Examples:
  ${name} "TypeScript tutorial" 5
  ${name} "React hooks" 10

Environment:
  WEB_SEARCH_SERVER   Bridge Server URL (default: http://127.0.0.1:8923)
  WEB_SEARCH_ENGINE   Preferred engine: auto|google|bing (default: auto)
  WEB_SEARCH_CLEANUP  Set to 1 to close browser after each search (default: keep alive)`);
  process.exit(1);
}

async function httpRequest(method, url, body) {
  const init = {
    method,
    signal: AbortSignal.timeout(30_000),
  };
  if (method !== 'GET') {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = body ?? '{}';
  }
  const response = await fetch(url, init);
  const text = await response.text();
  return { ok: response.ok, status: response.status, text };
}

async function httpGet(url) {
  try {
    return await httpRequest('GET', url);
  } catch {
    return { ok: false, status: 0, text: '' };
  }
}

async function httpPostJson(url, payload) {
  try {
    return await httpRequest('POST', url, JSON.stringify(payload ?? {}));
  } catch (error) {
    return { ok: false, status: 0, text: error instanceof Error ? error.message : String(error) };
  }
}

function buildSearchPayload(connectionId, query, maxResults, engine = 'auto') {
  const parsedMax = Number.parseInt(String(maxResults), 10);
  return {
    connectionId,
    query,
    maxResults: Number.isFinite(parsedMax) ? parsedMax : 10,
    engine: engine || 'auto',
  };
}

async function isServerHealthy(baseUrl) {
  const url = `${baseUrl.replace(/\/$/, '')}/api/health`;
  const res = await httpGet(url);
  return res.ok && res.text.includes('"success":true');
}

async function trySwitchToLocalServer() {
  if (ACTIVE_SERVER_URL === DEFAULT_SERVER_URL) {
    return false;
  }
  if (await isServerHealthy(DEFAULT_SERVER_URL)) {
    console.error(`Bridge Server at ${ACTIVE_SERVER_URL} is unavailable, falling back to ${DEFAULT_SERVER_URL}`);
    ACTIVE_SERVER_URL = DEFAULT_SERVER_URL;
    return true;
  }
  return false;
}

function printRecentServerLogs() {
  const logFile = path.join(PROJECT_DIR, '.server.log');
  if (!fs.existsSync(logFile)) return;
  console.error('  Recent logs:');
  const lines = fs.readFileSync(logFile, 'utf8').split(/\r?\n/).slice(-20);
  for (const line of lines) {
    console.error(line);
  }
}

async function checkServer() {
  if (await isServerHealthy(ACTIVE_SERVER_URL)) return;
  if (await trySwitchToLocalServer()) return;

  console.error('Bridge Server is not running, trying to start it...');
  const startRes = runHelperScript('start-server.mjs', [], { WEB_SEARCH_SERVER: ACTIVE_SERVER_URL });
  if (startRes.status !== 0) {
    if ((await isServerHealthy(ACTIVE_SERVER_URL)) || (await trySwitchToLocalServer())) {
      console.error('Bridge Server startup returned an error, but a healthy server is already available. Continuing...');
      return;
    }
    console.error('✗ Failed to auto-start Bridge Server');
    console.error(`  Try manually: node ${path.join(__dirname, 'start-server.mjs')}`);
    printRecentServerLogs();
    process.exit(1);
  }

  await sleep(2000);
  if (await isServerHealthy(ACTIVE_SERVER_URL)) return;
  if (await trySwitchToLocalServer()) return;

  console.error('✗ Bridge Server still unavailable after start');
  console.error(`  Endpoint checked: ${ACTIVE_SERVER_URL}/api/health`);
  printRecentServerLogs();
  process.exit(1);
}

function isIconvRuntimeError(responseText) {
  return responseText.includes('Cannot find module') && responseText.includes('encodings');
}

function isConnectionRuntimeError(responseText) {
  return [
    'Connection not found',
    'Connection not active',
    'Connection became invalid',
    'browserContext.newPage',
    'Target page, context or browser has been closed',
    'Failed to connect to CDP',
  ].some((needle) => responseText.includes(needle));
}

async function repairServerRuntime() {
  console.error('Detected broken web-search runtime, trying automatic repair...');
  fs.rmSync(CONNECTION_CACHE, { force: true });
  runHelperScript('stop-server.mjs');
  const startRes = runHelperScript('start-server.mjs', [], { WEB_SEARCH_FORCE_REPAIR: '1' });
  if (startRes.status !== 0) {
    console.error('✗ Failed to repair web-search runtime');
    printRecentServerLogs();
    return false;
  }
  await sleep(2000);
  return true;
}

async function isCachedConnectionValid(connectionId) {
  const res = await httpPostJson(`${ACTIVE_SERVER_URL.replace(/\/$/, '')}/api/page/text`, {
    connectionId,
  });
  return res.ok && res.text.includes('"success":true');
}

async function getConnection(attempt = 1) {
  const baseUrl = ACTIVE_SERVER_URL.replace(/\/$/, '');
  if (fs.existsSync(CONNECTION_CACHE)) {
    const cachedId = fs.readFileSync(CONNECTION_CACHE, 'utf8').trim();
    if (cachedId && (await isCachedConnectionValid(cachedId))) {
      return cachedId;
    }
    fs.rmSync(CONNECTION_CACHE, { force: true });
  }

  const launchRes = await httpPostJson(`${baseUrl}/api/browser/launch`, {});
  if (!launchRes.ok || !launchRes.text.includes('"success":true')) {
    if (attempt === 1 && isIconvRuntimeError(launchRes.text)) {
      if (await repairServerRuntime()) return getConnection(2);
    }
    if (attempt === 1 && isConnectionRuntimeError(launchRes.text)) {
      fs.rmSync(CONNECTION_CACHE, { force: true });
      runHelperScript('stop-server.mjs');
      const repairStart = runHelperScript('start-server.mjs', [], { WEB_SEARCH_FORCE_REPAIR: '1' });
      if (repairStart.status === 0) return getConnection(2);
    }
    console.error('✗ Failed to launch browser');
    console.error(launchRes.text);
    return null;
  }

  const connectRes = await httpPostJson(`${baseUrl}/api/browser/connect`, {});
  if (!connectRes.ok || !connectRes.text.includes('"success":true')) {
    if (attempt === 1 && isIconvRuntimeError(connectRes.text)) {
      if (await repairServerRuntime()) return getConnection(2);
    }
    if (attempt === 1 && isConnectionRuntimeError(connectRes.text)) {
      fs.rmSync(CONNECTION_CACHE, { force: true });
      runHelperScript('stop-server.mjs');
      const repairStart = runHelperScript('start-server.mjs', [], { WEB_SEARCH_FORCE_REPAIR: '1' });
      if (repairStart.status === 0) return getConnection(2);
    }
    console.error('✗ Failed to connect to browser');
    console.error(connectRes.text);
    return null;
  }

  let connectionId = '';
  try {
    const parsed = JSON.parse(connectRes.text);
    connectionId = String(parsed.connectionId || '');
  } catch {
    connectionId = '';
  }

  if (!connectionId) {
    console.error('✗ Failed to get connection ID');
    return null;
  }

  fs.writeFileSync(CONNECTION_CACHE, `${connectionId}\n`, 'utf8');
  return connectionId;
}

async function performSearch(query, maxResults, connectionId, attempt = 1) {
  const baseUrl = ACTIVE_SERVER_URL.replace(/\/$/, '');
  const engine = process.env.WEB_SEARCH_ENGINE || 'auto';
  console.error(`Searching for: "${query}"\n`);

  const payload = buildSearchPayload(connectionId, query, maxResults, engine);
  const res = await httpPostJson(`${baseUrl}/api/search`, payload);
  if (!res.ok || !res.text.includes('"success":true')) {
    if (attempt === 1 && isIconvRuntimeError(res.text)) {
      if (await repairServerRuntime()) {
        const nextConn = await getConnection(2);
        if (nextConn) return performSearch(query, maxResults, nextConn, 2);
      }
      return false;
    }
    if (attempt === 1 && isConnectionRuntimeError(res.text)) {
      fs.rmSync(CONNECTION_CACHE, { force: true });
      const nextConn = await getConnection(2);
      if (nextConn) return performSearch(query, maxResults, nextConn, 2);
    }
    console.error('✗ Search failed');
    console.error(res.text);
    return false;
  }

  let parsed = {};
  try {
    parsed = JSON.parse(res.text);
  } catch {
    console.error('✗ Failed to parse search response JSON');
    return false;
  }

  const duration = parsed.duration ?? 0;
  const total = parsed.totalResults ?? (Array.isArray(parsed.results) ? parsed.results.length : 0);
  const engineUsed = parsed.engine || 'unknown';
  console.error(`✓ Found ${total} results in ${duration}ms (engine: ${engineUsed})\n`);

  console.log(`# Search Results: ${query}\n`);
  console.log(`**Query:** ${query}  `);
  console.log(`**Engine:** ${engineUsed}  `);
  console.log(`**Results:** ${total}  `);
  console.log(`**Time:** ${duration}ms  \n`);
  console.log('---\n');

  const results = Array.isArray(parsed.results) ? parsed.results : [];
  for (const item of results) {
    const title = item.title ?? '';
    const url = item.url ?? '';
    const snippet = item.snippet ?? '';
    console.log(`## ${title}\n`);
    console.log(`**URL:** [${url}](${url})\n`);
    console.log(`${snippet}\n`);
    console.log('---\n');
  }
  return true;
}

async function cleanupBrowser(connectionId) {
  const baseUrl = ACTIVE_SERVER_URL.replace(/\/$/, '');
  if (connectionId) {
    await httpPostJson(`${baseUrl}/api/browser/disconnect`, { connectionId });
  }
  await httpPostJson(`${baseUrl}/api/browser/close`, {});
  fs.rmSync(CONNECTION_CACHE, { force: true });
}

function searchViaAnysearchGateway(query, maxResults) {
  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, 'anysearch-search.mjs'), query, String(maxResults)],
    {
      cwd: PROJECT_DIR,
      env: getChildRuntimeEnv(),
      stdio: 'inherit',
    },
  );
  return result.status ?? 1;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    usage();
  }

  let query = args[0];
  const maxResults = args[1] ?? '10';

  if (query.startsWith('@')) {
    const queryFile = query.slice(1);
    if (!fs.existsSync(queryFile) || !fs.statSync(queryFile).isFile()) {
      console.error(`✗ Query file not found: ${queryFile}`);
      return 1;
    }
    query = fs.readFileSync(queryFile, 'utf8').trimEnd();
  }

  if (process.env.ZHIYUAN_ANYSEARCH_GATEWAY_TOKEN) {
    return searchViaAnysearchGateway(query, maxResults);
  }

  await checkServer();
  const connectionId = await getConnection(1);
  if (!connectionId) {
    return 1;
  }

  const ok = await performSearch(query, maxResults, connectionId, 1);
  if (process.env.WEB_SEARCH_CLEANUP === '1') {
    await cleanupBrowser(connectionId);
  }
  return ok ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
