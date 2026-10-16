import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { _electron as electron } from 'playwright';

import { APP_DATA_DIR_NAME, DB_FILENAME, E2E_ARTIFACT_DIR, EXECUTABLE_NAME } from './constants.mjs';

export const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function runSqlite(dbPath, sql) {
  return execFileSync('sqlite3', [dbPath, sql], { encoding: 'utf8' }).trim();
}

export function resolveGlmApiKey() {
  const primary = process.env.GLM_API_KEY_1?.trim();
  if (primary) return { key: primary, source: 'GLM_API_KEY_1' };
  const fallback = process.env.GLM_API_KEY_2?.trim();
  if (fallback) return { key: fallback, source: 'GLM_API_KEY_2' };
  return null;
}

export async function resolvePackagedExecutable(unpackedDir) {
  const direct = path.join(unpackedDir, EXECUTABLE_NAME);
  try {
    const directStat = await stat(direct);
    if (directStat.isFile()) return direct;
  } catch {
    // Fall through to search release/.
  }

  const releaseRoot = path.resolve(unpackedDir, '..');
  const candidates = [];
  for (const name of ['linux-unpacked', '知远智能体 (ZhiYuan Agent)-linux-unpacked']) {
    candidates.push(path.join(releaseRoot, name, EXECUTABLE_NAME));
  }
  for (const candidate of candidates) {
    try {
      const candidateStat = await stat(candidate);
      if (candidateStat.isFile()) return candidate;
    } catch {
      // continue
    }
  }
  throw new Error(
    `Packaged Linux executable not found. Build with "bun run dist:linux" first. Tried: ${direct}`,
  );
}

export async function createIsolatedProfile(prefix = 'zhiyuan-packaged-e2e-') {
  const home = await mkdtemp(path.join(os.tmpdir(), prefix));
  const userDataPath = path.join(home, '.config', APP_DATA_DIR_NAME);
  await mkdir(userDataPath, { recursive: true });
  return { home, userDataPath, dbPath: path.join(userDataPath, DB_FILENAME) };
}

export function buildLaunchEnv(home, userDataPath, options = {}) {
  const llamaBin = options.llamaBin?.trim();
  const llamaLibDir = llamaBin ? path.dirname(llamaBin) : '';
  const ldLibraryPath = llamaLibDir
    ? [llamaLibDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')
    : process.env.LD_LIBRARY_PATH;
  return {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    APPDATA: path.join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_DATA_HOME: path.join(home, '.local', 'share'),
    ZHIYUAN_MEMORY_LEAK_TEST_USER_DATA: userDataPath,
    ZHIYUAN_ENABLE_GPU: 'false',
    ELECTRON_ENABLE_LOGGING: 'true',
    ...(llamaBin ? { LLAMACPP_BIN: llamaBin } : {}),
    ...(ldLibraryPath ? { LD_LIBRARY_PATH: ldLibraryPath } : {}),
  };
}

export async function launchPackagedApp(executablePath, env) {
  const electronApp = await electron.launch({
    executablePath,
    args: ['--no-sandbox', '--zhiyuan-linux-renderer-smoke'],
    env,
  });
  const page = await electronApp.firstWindow();
  await page
    .getByTestId('sidebar-new-conversation')
    .waitFor({ state: 'visible', timeout: 180_000 });
  return { electronApp, page };
}

export async function stopApp(electronApp) {
  if (!electronApp) return;
  try {
    await electronApp.close();
  } catch {
    // Process may already be gone.
  }
}

export async function screenshot(page, name) {
  await mkdir(E2E_ARTIFACT_DIR, { recursive: true });
  const target = path.join(E2E_ARTIFACT_DIR, `${name}.png`);
  await page.screenshot({ path: target, fullPage: true });
  return target;
}

const LEGACY_MEMORY_DDL = `
CREATE TABLE IF NOT EXISTS user_memories (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.75,
  is_explicit INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'created',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE TABLE IF NOT EXISTS user_memory_sources (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL,
  session_id TEXT,
  message_id TEXT,
  role TEXT NOT NULL DEFAULT 'system',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (memory_id) REFERENCES user_memories(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_user_memories_status_updated_at
  ON user_memories(status, updated_at DESC);
`;

export function seedLegacyUserMemoryTables(dbPath) {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const now = Date.now();
  runSqlite(
    dbPath,
    `${LEGACY_MEMORY_DDL}
INSERT OR REPLACE INTO user_memories (
  id, text, fingerprint, confidence, is_explicit, status, created_at, updated_at, last_used_at
) VALUES (
  'legacy-memory-1', 'Legacy preference: dark roast coffee', 'legacy-fp-1', 0.9, 1, 'created', ${now}, ${now}, NULL
);
INSERT OR REPLACE INTO user_memory_sources (
  id, memory_id, session_id, message_id, role, is_active, created_at
) VALUES (
  'legacy-source-1', 'legacy-memory-1', 'legacy-session', 'legacy-message', 'user', 1, ${now}
);`,
  );
}

export function createCcConnectProtocolHeaders(requestId = crypto.randomUUID()) {
  return {
    'x-zhiyuan-protocol-version': '1',
    'x-zhiyuan-request-id': requestId,
    'x-zhiyuan-timestamp-ms': String(Date.now()),
    'x-zhiyuan-nonce': crypto.randomUUID(),
  };
}

export function sqliteTableExists(dbPath, tableName) {
  if (!existsSync(dbPath)) return false;
  const escaped = tableName.replace(/'/g, "''");
  const result = runSqlite(
    dbPath,
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${escaped}' LIMIT 1;`,
  );
  return result.length > 0;
}

export async function downloadFile(url, destinationPath, timeoutMs = 900_000) {
  await mkdir(path.dirname(destinationPath), { recursive: true });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    if (!response.ok || !response.body) {
      throw new Error(`Download failed (${response.status}) for ${url}`);
    }
    await pipeline(response.body, createWriteStream(destinationPath));
  } finally {
    clearTimeout(timer);
  }
  return destinationPath;
}

async function parseCcConnectBridgeFromConfig(userDataPath) {
  const configPath = path.join(userDataPath, 'cc-connect', 'runtime', 'config.toml');
  const raw = await readFile(configPath, 'utf8');
  const bridgeUrl = raw.match(/bridge_url\s*=\s*"([^"]+)"/)?.[1];
  const bridgeToken = raw.match(/bridge_token\s*=\s*"([^"]+)"/)?.[1];
  if (!bridgeUrl || !bridgeToken) {
    throw new Error('cc-connect config.toml is missing bridge_url or bridge_token');
  }
  return { bridgeUrl, bridgeToken, configPath };
}

export async function waitForCcConnectConfig(userDataPath, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'config not written yet';
  while (Date.now() < deadline) {
    try {
      return await parseCcConnectBridgeFromConfig(userDataPath);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await delay(500);
    }
  }
  throw new Error(`Timed out waiting for cc-connect config: ${lastError}`);
}

export function waitForRunCompletion(page, sessionId, timeoutMs = 600_000) {
  return page.evaluate(
    ({ targetSessionId, timeout }) =>
      new Promise((resolve, reject) => {
        const api = window.electron?.cowork;
        if (!api?.onStreamRunState || !api.getRunSnapshot) {
          reject(new Error('Cowork run APIs are unavailable in renderer'));
          return;
        }
        let settled = false;
        const timer = window.setTimeout(() => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(new Error(`Timed out waiting for session ${targetSessionId} to finish`));
        }, timeout);
        const terminal = new Set(['completed', 'error', 'stopped']);
        const cleanup = api.onStreamRunState(snapshot => {
          if (snapshot.sessionId !== targetSessionId || settled) return;
          if (!snapshot.running && terminal.has(snapshot.phase)) {
            settled = true;
            window.clearTimeout(timer);
            cleanup();
            resolve(snapshot);
          }
        });
        void api.getRunSnapshot(targetSessionId).then(snapshot => {
          if (!snapshot?.snapshot || settled) return;
          const current = snapshot.snapshot;
          if (!snapshot.running && terminal.has(current.phase)) {
            settled = true;
            window.clearTimeout(timer);
            cleanup();
            resolve(current);
          }
        });
      }),
    { targetSessionId: sessionId, timeout: timeoutMs },
  );
}

export async function configureGlmProvider(page, apiKey, { baseURL, model }) {
  return page.evaluate(
    async ({ baseURL: resolvedBaseUrl, model: resolvedModel, key }) => {
      const result = await window.electron.saveApiConfig({
        apiKey: key,
        baseURL: resolvedBaseUrl,
        model: resolvedModel,
        apiType: 'openai',
      });
      if (!result.success) throw new Error(result.error || 'saveApiConfig failed');
      if (window.electron.magpie?.start) {
        const started = await window.electron.magpie.start();
        if (started && started.state && started.state !== 'running') {
          throw new Error(`magpie.start state=${started.state} ${started.error || ''}`);
        }
      }
      if (window.electron.magpie?.models) {
        const res = await window.electron.magpie.models();
        const list = Array.isArray(res) ? res : (res?.data ?? res?.models ?? []);
        const ids = list.map(entry => entry?.id ?? entry?.modelId ?? String(entry));
        const pick = ids.find(id =>
          String(id).toLowerCase().includes(String(resolvedModel).toLowerCase()),
        );
        if (!pick) {
          throw new Error(
            `no magpie model matches ${resolvedModel}; ids=${JSON.stringify(ids).slice(0, 800)}`,
          );
        }
        const sel = await window.electron.magpie.selectDefault(pick);
        if (sel?.success === false) {
          throw new Error(sel.error || `selectDefault failed for ${pick}`);
        }
      }
      const readiness = await window.electron.checkApiConfig({ probeModel: true });
      if (!readiness.hasConfig) {
        throw new Error(readiness.error || 'checkApiConfig failed after GLM setup');
      }
      return readiness;
    },
    { baseURL, model, key: apiKey },
  );
}

export async function seedMagpieZhipu(executablePath, profile, apiKey, model) {
  const { spawnSync } = await import('node:child_process');
  const bin = path.join(path.dirname(executablePath), 'resources', 'magpie', 'linux-x64', 'magpie');
  const root = path.join(profile.userDataPath, 'magpie');
  const env = {
    PATH: process.env.PATH,
    HOME: profile.home,
    DO_NOT_TRACK: '1',
    MAGPIE_NO_ACCOUNTS: '1',
    XDG_CONFIG_HOME: path.join(root, 'config'),
    XDG_CACHE_HOME: path.join(root, 'cache'),
    XDG_DATA_HOME: path.join(root, 'data'),
    XDG_STATE_HOME: path.join(root, 'state'),
  };
  const add = spawnSync(bin, ['provider', 'add', 'zhipu', apiKey], {
    env,
    encoding: 'utf8',
    timeout: 60_000,
  });
  const models = spawnSync(bin, ['provider', 'models', 'zhipu', model], {
    env,
    encoding: 'utf8',
    timeout: 60_000,
  });
  const redact = value =>
    String(value ?? '')
      .split(String(apiKey))
      .join('[REDACTED]');
  return {
    addStatus: add.status ?? String(add.error?.code),
    modelsStatus: models.status,
    modelsHint: redact(`${models.stdout ?? ''}${models.stderr ?? ''}`).slice(0, 300),
  };
}

export function findActiveMemoryRow(dbPath, needle) {
  if (!existsSync(dbPath)) return null;
  const escaped = needle.replace(/'/g, "''");
  const rows = execFileSync(
    'sqlite3',
    [
      dbPath,
      `SELECT id, title, content FROM memory_links WHERE status = 'active' AND content LIKE '%${escaped}%' LIMIT 1;`,
    ],
    { encoding: 'utf8' },
  ).trim();
  if (!rows) return null;
  const [id, title, content] = rows.split('|');
  return { id, title, content };
}

export async function writeJsonReport(results) {
  await mkdir(E2E_ARTIFACT_DIR, { recursive: true });
  const reportPath = path.join(E2E_ARTIFACT_DIR, 'report.json');
  await writeFile(
    reportPath,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)}\n`,
  );
  return reportPath;
}

export async function cleanupProfile(home) {
  if (!home) return;
  await rm(home, { recursive: true, force: true });
}
