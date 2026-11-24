/**
 * Minimal Pi adapter probe driver for aimock chaos/misbehavior tests.
 *
 * Boots the real adapter stack (SqliteStore + Magpie catalog + WorkbenchTask
 * + PiRuntimeAdapter) against a caller-supplied OpenAI-compatible endpoint,
 * runs a single short prompt, and settles on complete / error / hard cap.
 * Deliberately separate from the 32-document long-task scenario: chaos probes
 * need a two-tool-call conversation, not a document marathon.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import { ModelCapabilityStatus } from '@shared/providers';
import { WorkbenchApprovalMode } from '@shared/workbenchTask';

import { CoworkExecutionMode } from '../../src/shared/cowork/constants';
import { CoworkStore } from '../../src/main/coworkStore';
import { composeCoworkSystemPrompt } from '../../src/main/coworkPrompt/composer';
import { createTestMagpie } from '../helpers/createTestMagpie';
import { PiRuntimeAdapter } from '../../src/main/libs/agentEngine/piRuntimeAdapter';
import { SqliteStore } from '../../src/main/sqliteStore';
import { initializeWorkbenchTaskSchema } from '../../src/main/workbenchTask/schema';
import { WorkbenchTaskService } from '../../src/main/workbenchTask/taskService';

const mutableApp = app as unknown as Record<string, unknown>;
if (typeof mutableApp.getAppPath !== 'function') {
  mutableApp.getAppPath = () => process.cwd();
}

const PROBE_MODEL_ID = 'probe-model';
const PROBE_PROVIDER = 'custom_probe';

export interface AdapterProbeOptions {
  providerBaseUrl: string;
  providerPort: number;
  workDir: string;
  prompt: string;
  hardCapMs: number;
}

export interface AdapterProbeResult {
  outcome: { status: string; reason?: string };
  errors: string[];
  counts: { total: number; byType: Record<string, number> };
  workbenchTaskStatus: string | null;
  fileExists: (name: string) => boolean;
}

export async function runAdapterProbe(options: AdapterProbeOptions): Promise<AdapterProbeResult> {
  fs.rmSync(options.workDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(options.workDir, 'data'), { recursive: true });
  fs.writeFileSync(
    path.join(options.workDir, 'data', 'probe.txt'),
    '探针文件内容：混沌测试。',
    'utf8',
  );

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aimock-probe-store-'));
  const store = await SqliteStore.create(userData);
  let adapter: PiRuntimeAdapter | null = null;
  try {
    store.set('app_config', {
      api: { key: '', baseUrl: '' },
      model: {
        availableModels: [{ id: PROBE_MODEL_ID, name: PROBE_MODEL_ID }],
        defaultModel: PROBE_MODEL_ID,
        defaultModelProvider: PROBE_PROVIDER,
      },
      providers: {
        [PROBE_PROVIDER]: {
          enabled: true,
          apiKey: '',
          baseUrl: options.providerBaseUrl,
          apiFormat: 'openai',
          models: [
            {
              id: PROBE_MODEL_ID,
              name: PROBE_MODEL_ID,
              supportsImage: false,
              capabilities: { imageInput: ModelCapabilityStatus.Unsupported },
              contextWindow: 65_536,
              maxTokens: 4096,
            },
          ],
        },
      },
      theme: 'system',
      language: 'zh',
      useSystemProxy: false,
      app: { port: 0, isDevelopment: false },
    });
    const gateway = createTestMagpie({
      gatewayUrl: `http://127.0.0.1:${options.providerPort}`,
      defaultModelId: PROBE_MODEL_ID,
      acceptUnknownModels: false,
    });
    gateway.upsert(PROBE_MODEL_ID, {
      context_window: 65_536,
      max_output_tokens: 4096,
    });

    const db = store.getDatabase();
    initializeWorkbenchTaskSchema(db);
    const coworkStore = new CoworkStore(db);
    const workbenchTaskService = new WorkbenchTaskService(db);

    adapter = new PiRuntimeAdapter({
      modelService: gateway.modelService,
      coworkStore,
      workbenchTaskService,
    });

    const counts: AdapterProbeResult['counts'] = { total: 0, byType: {} };
    const errors: string[] = [];
    adapter.on('executionEvent', (_sessionId, event) => {
      counts.total += 1;
      counts.byType[event.type] = (counts.byType[event.type] ?? 0) + 1;
    });
    adapter.on('permissionRequest', (_sessionId, request) => {
      adapter?.respondToPermission(request.requestId, { behavior: 'allow' });
    });
    adapter.on('error', (_sessionId, error) => {
      errors.push(String(error instanceof Error ? error.message : JSON.stringify(error)));
    });

    const systemPrompt = composeCoworkSystemPrompt({
      basePrompt: '',
      expertSnapshots: [],
      language: 'zh',
    });
    const session = coworkStore.createSession(
      'aimock-probe',
      options.workDir,
      systemPrompt,
      CoworkExecutionMode.Local,
      [],
      'main',
      '',
      'work',
      'aimock-probe-session',
    );

    const outcome: AdapterProbeResult['outcome'] = await new Promise(resolve => {
      let settled = false;
      let errorGraceTimer: ReturnType<typeof setTimeout> | null = null;
      const finish = (result: AdapterProbeResult['outcome']) => {
        if (settled) return;
        settled = true;
        clearTimeout(capTimer);
        if (errorGraceTimer) clearTimeout(errorGraceTimer);
        resolve(result);
      };
      const capTimer = setTimeout(() => {
        finish({ status: 'timeout', reason: `hard cap ${options.hardCapMs}ms reached` });
      }, options.hardCapMs);
      adapter!.on('complete', completedSessionId => {
        if (completedSessionId !== session.id) return;
        finish({ status: 'complete' });
      });
      adapter!.on('error', erroredSessionId => {
        if (erroredSessionId !== session.id) return;
        // Mid-run errors can be recovered by the stall auto-resume; only
        // settle as failed once the session stays down through a grace window.
        if (errorGraceTimer) clearTimeout(errorGraceTimer);
        errorGraceTimer = setTimeout(() => {
          if (!adapter!.isSessionRunning(session.id)) {
            finish({ status: 'error', reason: 'session stopped after an error' });
          }
        }, 2000);
      });
      adapter!
        .startSession(session.id, options.prompt, {
          skipInitialUserMessage: true,
          systemPrompt,
          workspaceRoot: options.workDir,
          confirmationMode: 'modal',
          sessionMode: 'work',
          approvalMode: WorkbenchApprovalMode.Ask,
        })
        .catch((error: unknown) => {
          finish({ status: 'start_rejected', reason: String(error) });
        });
    });

    return {
      outcome,
      errors,
      counts,
      workbenchTaskStatus: workbenchTaskService.getCurrent(session.id)?.task.status ?? null,
      fileExists: name => fs.existsSync(path.join(options.workDir, name)),
    };
  } finally {
    if (adapter) await adapter.stopAllSessions();
    store.close();
    fs.rmSync(userData, { recursive: true, force: true });
  }
}
