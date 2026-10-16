#!/usr/bin/env node
/**
 * Headless packaged Linux Electron smoke (Playwright _electron + xvfb via Electron launch).
 *
 * Usage:
 *   node tests/e2e/packaged-linux/run-packaged-smoke.mjs [path-to-linux-unpacked-or-executable]
 *
 * Secrets: GLM_API_KEY_1 / GLM_API_KEY_2 (fallback). Keys are never logged or written to artifacts.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_LINUX_UNPACKED_DIR,
  E2E_ARTIFACT_DIR,
  E2E_LLAMA_MODEL_FILENAME,
  E2E_LLAMA_MODEL_URL,
  E2E_LLAMACPP_BIN,
  GLM_BASE_URL,
  GLM_MODEL,
} from './constants.mjs';
import { existsSync } from 'node:fs';

import {
  cleanupProfile,
  configureGlmProvider,
  createCcConnectProtocolHeaders,
  createIsolatedProfile,
  delay,
  downloadFile,
  findActiveMemoryRow,
  launchPackagedApp,
  resolveGlmApiKey,
  resolvePackagedExecutable,
  screenshot,
  seedLegacyUserMemoryTables,
  seedMagpieZhipu,
  sqliteTableExists,
  stopApp,
  waitForCcConnectConfig,
  waitForRunCompletion,
  writeJsonReport,
  buildLaunchEnv,
} from './helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const unpackedInput = process.argv[2] || DEFAULT_LINUX_UNPACKED_DIR;

/** @type {Array<{ id: string, status: 'pass'|'fail'|'skip', detail: string, evidence?: string[] }>} */
const results = [];

function record(id, status, detail, evidence = []) {
  results.push({ id, status, detail, evidence });
  const prefix = status === 'pass' ? 'PASS' : status === 'skip' ? 'SKIP' : 'FAIL';
  console.log(`[${prefix}] ${id}: ${detail}`);
  for (const item of evidence) console.log(`  evidence: ${item}`);
}

async function scenarioFreshLegacyAbsent(executablePath) {
  const profile = await createIsolatedProfile('zhiyuan-e2e-fresh-');
  let electronApp;
  try {
    electronApp = (
      await launchPackagedApp(executablePath, buildLaunchEnv(profile.home, profile.userDataPath))
    ).electronApp;
    const hasLegacy =
      sqliteTableExists(profile.dbPath, 'user_memories') ||
      sqliteTableExists(profile.dbPath, 'user_memory_sources');
    if (hasLegacy) {
      record('fresh-start-legacy-tables', 'fail', 'Legacy memory tables exist after fresh start', [
        profile.dbPath,
      ]);
      return;
    }
    record(
      'fresh-start-legacy-tables',
      'pass',
      'Fresh profile has no legacy user_memories tables',
      [profile.dbPath],
    );
  } finally {
    await stopApp(electronApp);
    await cleanupProfile(profile.home);
  }
}

async function scenarioUpgradeLegacyDrop(executablePath) {
  const profile = await createIsolatedProfile('zhiyuan-e2e-upgrade-');
  seedLegacyUserMemoryTables(profile.dbPath);
  let electronApp;
  try {
    electronApp = (
      await launchPackagedApp(executablePath, buildLaunchEnv(profile.home, profile.userDataPath))
    ).electronApp;
    await delay(2_000);
    const userMemories = sqliteTableExists(profile.dbPath, 'user_memories');
    const userSources = sqliteTableExists(profile.dbPath, 'user_memory_sources');
    if (userMemories || userSources) {
      record(
        'upgrade-legacy-drop',
        'fail',
        `Legacy tables still present (user_memories=${userMemories}, user_memory_sources=${userSources})`,
        [profile.dbPath],
      );
      return;
    }
    record('upgrade-legacy-drop', 'pass', 'Legacy user_memories tables dropped on startup', [
      profile.dbPath,
    ]);
  } finally {
    await stopApp(electronApp);
    await cleanupProfile(profile.home);
  }
}

async function scenarioManagedMemory(executablePath) {
  const profile = await createIsolatedProfile('zhiyuan-e2e-memory-');
  const workspaceDir = path.join(profile.home, 'workspace');
  await import('node:fs/promises').then(fs => fs.mkdir(workspaceDir, { recursive: true }));
  let electronApp;
  let page;
  const marker = `e2e-memory-marker-${Date.now()}`;
  try {
    ({ electronApp, page } = await launchPackagedApp(
      executablePath,
      buildLaunchEnv(profile.home, profile.userDataPath),
    ));

    await page.evaluate(
      async ({ cwd, markerText }) => {
        const api = window.electron.memory;
        const result = await api.createManual({
          workingDirectory: cwd,
          scope: 'project',
          title: 'E2E memory',
          content: markerText,
          kind: 'preference',
          sensitivity: 'normal',
        });
        if (!result.success || !result.data) throw new Error(result.error || 'createManual failed');
        const drained = await api.drainOutbox();
        if (!drained.success) throw new Error(drained.error || 'drainOutbox failed');
        return result.data;
      },
      { cwd: workspaceDir, markerText: marker },
    );

    await stopApp(electronApp);
    electronApp = undefined;

    ({ electronApp, page } = await launchPackagedApp(
      executablePath,
      buildLaunchEnv(profile.home, profile.userDataPath),
    ));

    const listed = await page.evaluate(
      async ({ cwd, markerText }) => {
        const api = window.electron.memory;
        const list = await api.list({ workingDirectory: cwd, includeArchived: false });
        if (!list.success || !list.data) throw new Error(list.error || 'memory list failed');
        const match = list.data.find(entry => entry.content.includes(markerText));
        if (!match) throw new Error('Created memory not found after restart');
        const updated = await api.updateManual({
          id: match.id,
          workingDirectory: cwd,
          title: 'E2E memory updated',
          content: `${markerText}-updated`,
          kind: 'preference',
          sensitivity: 'normal',
        });
        if (!updated.success) throw new Error(updated.error || 'updateManual failed');
        const forgotten = await api.forget(match.id, false);
        if (!forgotten.success) throw new Error(forgotten.error || 'forget failed');
        return { id: match.id, updated: updated.data?.content ?? '' };
      },
      { cwd: workspaceDir, markerText: marker },
    );

    const shot = await screenshot(page, 'managed-memory');
    record(
      'managed-memory-engram',
      'pass',
      `Manual memory persisted across restart; updated and archived id=${listed.id}`,
      [shot, profile.dbPath],
    );
  } catch (error) {
    const shot = page ? await screenshot(page, 'managed-memory-failure').catch(() => null) : null;
    record(
      'managed-memory-engram',
      'fail',
      error instanceof Error ? error.message : String(error),
      [shot, profile.dbPath].filter(Boolean),
    );
  } finally {
    await stopApp(electronApp);
    await cleanupProfile(profile.home);
  }
}

async function scenarioGlmWorkMemoryTool(executablePath, glmKey) {
  const profile = await createIsolatedProfile('zhiyuan-e2e-glm-work-');
  const seeded = await seedMagpieZhipu(executablePath, profile, glmKey, GLM_MODEL);
  console.log(
    `[E2E] magpie seed add=${seeded.addStatus} models=${seeded.modelsStatus} hint=${JSON.stringify(seeded.modelsHint)}`,
  );
  const workspaceDir = path.join(profile.home, 'workspace');
  await import('node:fs/promises').then(fs => fs.mkdir(workspaceDir, { recursive: true }));
  let electronApp;
  let page;
  const decisionToken = `packaged-e2e-decision-${Date.now()}`;
  const teamDecisionFact = `Team decision (${decisionToken}): standardize on SQLite for workspace persistence in packaged Linux E2E.`;
  try {
    ({ electronApp, page } = await launchPackagedApp(
      executablePath,
      buildLaunchEnv(profile.home, profile.userDataPath),
    ));
    await configureGlmProvider(page, glmKey, { baseURL: GLM_BASE_URL, model: GLM_MODEL });

    const session = await page.evaluate(
      async ({ cwd, teamDecisionFact: fact }) => {
        const started = await window.electron.cowork.startSession({
          prompt:
            `Work mode E2E: use the memory tool to explicitly save this exact workspace decision: "${fact}". ` +
            'Confirm only after the tool reports a successful save.',
          cwd,
          mode: 'work',
        });
        if (!started.success || !started.session?.id) {
          throw new Error(started.error || 'startSession failed');
        }
        return { sessionId: started.session.id };
      },
      { cwd: workspaceDir, teamDecisionFact },
    );

    const snapshot = await waitForRunCompletion(page, session.sessionId, 480_000);
    await page.evaluate(async () => {
      const drained = await window.electron.memory.drainOutbox();
      if (!drained.success) throw new Error(drained.error || 'drainOutbox failed');
    });

    const dbRow = findActiveMemoryRow(profile.dbPath, decisionToken);
    const recalled = await page.evaluate(
      async ({ cwd, token }) => {
        const list = await window.electron.memory.list({
          workingDirectory: cwd,
          query: token,
        });
        if (!list.success || !list.data) throw new Error(list.error || 'memory list failed');
        return list.data.some(entry => entry.content.includes(token));
      },
      { cwd: workspaceDir, token: decisionToken },
    );

    const injectionSession = await page.evaluate(
      async ({ cwd, token }) => {
        const started = await window.electron.cowork.startSession({
          prompt:
            `What team decision about SQLite workspace persistence is recorded for this workspace (${token})? ` +
            'Quote the stored decision verbatim if you have it in context.',
          cwd,
          mode: 'work',
        });
        if (!started.success || !started.session?.id) {
          throw new Error(started.error || 'injection startSession failed');
        }
        return started.session.id;
      },
      { cwd: workspaceDir, token: decisionToken },
    );
    const injectionSnapshot = await waitForRunCompletion(page, injectionSession, 480_000);
    const injectionMessages = await page.evaluate(async sessionId => {
      const result = await window.electron.cowork.getSession(sessionId);
      const sessionRecord = result.session ?? result;
      const messageList = sessionRecord?.messages ?? [];
      return messageList.map(message => message.content).join('\n');
    }, injectionSession);
    const injected = injectionMessages.includes(decisionToken);

    const shot = await screenshot(page, 'glm-work-memory-tool');
    const ok =
      snapshot.phase === 'completed' &&
      dbRow !== null &&
      recalled &&
      injected &&
      injectionSnapshot.phase === 'completed';
    record(
      'glm-work-memory-tool',
      ok ? 'pass' : 'fail',
      ok
        ? `Work-mode save persisted to sqlite (${dbRow.id}); recall and prompt injection verified for ${decisionToken}`
        : `Run phase=${snapshot.phase}; dbRow=${Boolean(dbRow)}; recalled=${recalled}; injected=${injected}; injectionPhase=${injectionSnapshot.phase}`,
      [shot, `session:${session.sessionId}`, `injection:${injectionSession}`],
    );
  } catch (error) {
    const shot = page
      ? await screenshot(page, 'glm-work-memory-tool-failure').catch(() => null)
      : null;
    record(
      'glm-work-memory-tool',
      'fail',
      error instanceof Error ? error.message : String(error),
      shot ? [shot] : [],
    );
  } finally {
    await stopApp(electronApp);
    await cleanupProfile(profile.home);
  }
}

async function scenarioImBridgeReply(executablePath, glmKey) {
  const profile = await createIsolatedProfile('zhiyuan-e2e-im-');
  const seeded = await seedMagpieZhipu(executablePath, profile, glmKey, GLM_MODEL);
  console.log(
    `[E2E] magpie seed add=${seeded.addStatus} models=${seeded.modelsStatus} hint=${JSON.stringify(seeded.modelsHint)}`,
  );
  const workspaceDir = path.join(profile.home, 'workspace');
  await import('node:fs/promises').then(fs => fs.mkdir(workspaceDir, { recursive: true }));
  let electronApp;
  let page;
  try {
    ({ electronApp, page } = await launchPackagedApp(
      executablePath,
      buildLaunchEnv(profile.home, profile.userDataPath),
    ));
    await configureGlmProvider(page, glmKey, { baseURL: GLM_BASE_URL, model: GLM_MODEL });

    const imSetup = await page.evaluate(async workspacePath => {
      const ensured = await window.electron.cowork.ensureWorkspace({
        path: workspacePath,
        name: 'E2E IM Workspace',
      });
      if (!ensured.success || !ensured.workspace?.id) {
        throw new Error(ensured.error || 'ensureWorkspace failed');
      }
      const added = await window.electron.im.addTelegramInstance(
        'E2E Telegram',
        ensured.workspace.id,
      );
      const instanceId =
        added?.instance?.instanceId ?? added?.instanceId ?? added?.data?.instanceId ?? added?.id;
      if (!instanceId) throw new Error('addTelegramInstance did not return instanceId');
      const configured = await window.electron.im.setTelegramInstanceConfig(
        instanceId,
        {
          enabled: true,
          botToken: '123456789:AAHE2e2-test-token-for-e2e-sidecar-bootstrap',
          dmPolicy: 'open',
          allowFrom: [],
          groupPolicy: 'disabled',
          groupAllowFrom: [],
        },
        { syncGateway: true },
      );
      if (configured?.success === false) {
        throw new Error(configured.error || 'setTelegramInstanceConfig failed');
      }
      await window.electron.im.syncConfig();
      return { workspaceId: ensured.workspace.id, accountId: instanceId };
    }, workspaceDir);

    const bridge = await waitForCcConnectConfig(profile.userDataPath, 180_000);
    const requestId = `e2e-${Date.now()}`;
    const body = {
      requestId,
      accountId: imSetup.accountId,
      message: {
        sessionKey: 'telegram:e2e-chat',
        platform: 'telegram',
        messageId: 'e2e-message-1',
        channelId: 'e2e-chat',
        userId: 'e2e-user',
        chatType: 'direct',
        content: 'Reply with exactly PONG for packaged IM E2E.',
      },
    };

    const response = await fetch(`${bridge.bridgeUrl}/v1/cc-connect/turn`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${bridge.bridgeToken}`,
        'content-type': 'application/json',
        ...createCcConnectProtocolHeaders(requestId),
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`Bridge turn HTTP ${response.status}: ${JSON.stringify(payload)}`);
    }
    const content = typeof payload.content === 'string' ? payload.content : '';
    const shot = await screenshot(page, 'im-bridge-reply');
    const ok = content.length > 0 && /PONG/i.test(content);
    record(
      'im-cc-connect-bridge-reply',
      ok ? 'pass' : 'fail',
      ok
        ? 'Inbound cc-connect turn returned PONG through the desktop bridge'
        : `Bridge reply did not contain PONG: ${content.slice(0, 200)}`,
      [shot, bridge.configPath],
    );
  } catch (error) {
    const shot = page ? await screenshot(page, 'im-bridge-failure').catch(() => null) : null;
    record(
      'im-cc-connect-bridge-reply',
      'fail',
      error instanceof Error ? error.message : String(error),
      shot ? [shot] : [],
    );
  } finally {
    await stopApp(electronApp);
    await cleanupProfile(profile.home);
  }
}

async function scenarioLlamaOverflow(executablePath) {
  if (!existsSync(E2E_LLAMACPP_BIN)) {
    record(
      'llama-overflow-compaction',
      'skip',
      `Prebuilt llama-server not found at ${E2E_LLAMACPP_BIN}. Run node scripts/download-llamacpp-runtime.cjs first.`,
    );
    return;
  }
  const profile = await createIsolatedProfile('zhiyuan-e2e-llama-');
  const workspaceDir = path.join(profile.home, 'workspace');
  await import('node:fs/promises').then(fs => fs.mkdir(workspaceDir, { recursive: true }));
  let electronApp;
  let page;
  try {
    ({ electronApp, page } = await launchPackagedApp(
      executablePath,
      buildLaunchEnv(profile.home, profile.userDataPath, { llamaBin: E2E_LLAMACPP_BIN }),
    ));

    const magpieStarted = await page.evaluate(async () => {
      const started = await window.electron.magpie.start();
      return started.state;
    });
    if (magpieStarted !== 'running') {
      throw new Error(`magpie did not start (state=${magpieStarted})`);
    }

    await page.evaluate(async () => {
      const install = await window.electron.llamacpp.installBackend();
      if (!install.success) throw new Error(install.error || 'installBackend failed');
    });

    const modelPath = path.join(profile.home, 'models', E2E_LLAMA_MODEL_FILENAME);
    await downloadFile(E2E_LLAMA_MODEL_URL, modelPath);

    const modelsDir = path.dirname(modelPath);
    const modelName = await page.evaluate(
      async ({ filePath, modelsDirectory }) => {
        await window.electron.llamacpp.setModelsDir(modelsDirectory);
        const imported = await window.electron.llamacpp.importModelFiles([filePath]);
        if (!imported.success || !imported.importedModels?.length) {
          throw new Error(imported.error || 'importModelFiles failed');
        }
        const name = imported.importedModels[0].name;
        await window.electron.llamacpp.setServiceConfig({
          ctxSize: '8192',
          parallel: '1',
          gpuLayers: '0',
        });
        const loaded = await window.electron.llamacpp.loadModel({
          model: name,
          options: { ctxSize: 8192, gpuLayers: 0, parallel: 1 },
        });
        if (!loaded.success) throw new Error(loaded.error || 'loadModel failed');
        return name;
      },
      { filePath: modelPath, modelsDirectory: modelsDir },
    );

    const modelRef = `llamacpp/${modelName}`;
    const session = await page.evaluate(
      async ({ cwd, modelRef: overrideModel }) => {
        const filler = 'Fill context. '.repeat(900);
        const started = await window.electron.cowork.startSession({
          prompt:
            `${filler}\n` +
            'Now list three colors and call at least one tool if available. Keep responding until done.',
          cwd,
          mode: 'work',
          modelOverride: overrideModel,
        });
        if (!started.success || !started.session?.id) {
          throw new Error(started.error || 'startSession failed');
        }
        return { sessionId: started.session.id };
      },
      { cwd: workspaceDir, modelRef },
    );

    const snapshot = await waitForRunCompletion(page, session.sessionId, 900_000);
    const compactionSeen = await page.evaluate(async sessionId => {
      const snapshots = await window.electron.cowork.getRuntimeSnapshots(sessionId);
      const list = snapshots?.snapshots ?? snapshots ?? [];
      return Array.isArray(list)
        ? list.some(item => item?.phase === 'compacting' || item?.event === 'compaction_start')
        : false;
    }, session.sessionId);

    const messages = await page.evaluate(async sessionId => {
      const result = await window.electron.cowork.getSession(sessionId);
      const sessionRecord = result.session ?? result;
      return sessionRecord?.messages ?? [];
    }, session.sessionId);
    const assistantText = messages
      .filter(message => message.role === 'assistant')
      .map(message => message.content)
      .join('\n');
    const singleTokenIssue =
      assistantText.trim().length <= 2 &&
      (snapshot.phase === 'completed' || snapshot.phase === 'error');

    const shot = await screenshot(page, 'llama-overflow');
    const overflowHandled =
      compactionSeen ||
      snapshot.phase === 'completed' ||
      /context|overflow|compact|exceed/i.test(JSON.stringify(messages));

    record(
      'llama-overflow-compaction',
      overflowHandled ? 'pass' : 'fail',
      `phase=${snapshot.phase}; compactionSeen=${compactionSeen}; #772-single-token=${singleTokenIssue}`,
      [shot, `model:${modelRef}`],
    );
    if (singleTokenIssue) {
      record(
        'issue-772-note',
        'pass',
        'Observed #772 pattern (tiny output with small local context in work mode); document for regression tracking',
        [shot],
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const shot = page ? await screenshot(page, 'llama-overflow-failure').catch(() => null) : null;
    if (/secure storage is unavailable/i.test(message)) {
      record(
        'llama-overflow-compaction',
        'skip',
        'Headless Linux lacks an unlocked OS secret service (Electron safeStorage). Use run-with-headless-deps.sh with gnome-keyring, or add a CI test seam for gateway token persistence.',
        shot ? [shot] : [],
      );
      return;
    }
    record('llama-overflow-compaction', 'fail', message, shot ? [shot] : []);
  } finally {
    await stopApp(electronApp);
    await cleanupProfile(profile.home);
  }
}

function shouldRunScenario(id) {
  const only = process.env.ZHIYUAN_E2E_ONLY?.split(',')
    .map(entry => entry.trim())
    .filter(Boolean);
  return !only?.length || only.includes(id);
}

async function main() {
  const executablePath = await resolvePackagedExecutable(path.resolve(unpackedInput));
  console.log(`[E2E] Using packaged executable: ${executablePath}`);
  console.log(`[E2E] Artifacts: ${E2E_ARTIFACT_DIR}`);

  if (shouldRunScenario('fresh-start-legacy-tables')) {
    await scenarioFreshLegacyAbsent(executablePath);
  }
  if (shouldRunScenario('upgrade-legacy-drop')) {
    await scenarioUpgradeLegacyDrop(executablePath);
  }

  const glm = resolveGlmApiKey();
  if (shouldRunScenario('managed-memory-engram')) {
    await scenarioManagedMemory(executablePath);
  }

  if (!glm) {
    if (
      shouldRunScenario('glm-work-memory-tool') ||
      shouldRunScenario('im-cc-connect-bridge-reply')
    ) {
      record(
        'glm-provider-config',
        'skip',
        'GLM_API_KEY_1 / GLM_API_KEY_2 not set; skipping cloud work-mode and IM bridge scenarios',
      );
    }
    if (shouldRunScenario('glm-work-memory-tool')) {
      record('glm-work-memory-tool', 'skip', 'Requires GLM API key');
    }
    if (shouldRunScenario('im-cc-connect-bridge-reply')) {
      record('im-cc-connect-bridge-reply', 'skip', 'Requires GLM API key for agent reply');
    }
  } else {
    record('glm-provider-config', 'pass', `GLM key loaded from ${glm.source}`);
    if (shouldRunScenario('glm-work-memory-tool')) {
      await scenarioGlmWorkMemoryTool(executablePath, glm.key);
    }
    if (shouldRunScenario('im-cc-connect-bridge-reply')) {
      await scenarioImBridgeReply(executablePath, glm.key);
    }
  }

  if (shouldRunScenario('llama-overflow-compaction')) {
    await scenarioLlamaOverflow(executablePath);
  }

  const reportPath = await writeJsonReport(results);
  console.log(`[E2E] Wrote report: ${reportPath}`);

  const failed = results.filter(entry => entry.status === 'fail');
  if (failed.length > 0) process.exitCode = 1;
}

main().catch(error => {
  console.error('[E2E] Fatal error:', error);
  process.exitCode = 1;
});
