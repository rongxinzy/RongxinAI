/**
 * Offline A/B comparison harness: Pi baseline vs SoL-Pi conservative profile.
 *
 * Uses the real @earendil-works/pi-coding-agent 0.84.2 from this repo with a
 * scripted fake model (modelRuntime.streamSimple) — no network, no paid
 * provider, no credentials. It verifies MECHANISM behavior (turn counts,
 * projected context size, approval enforcement, stop correctness) with the
 * same model script on both sides. It does NOT measure real-model quality or
 * real-world token savings; those require the real-model protocol in
 * src/main/libs/solPi/README.md.
 *
 * Bounds: hard process deadline, max 8 model calls per variant.
 *
 * Usage: node scripts/solpi-comparison-harness.mjs [--workdir <dir>]
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pi = await import('@earendil-works/pi-coding-agent');

const deadline = setTimeout(() => {
  console.error('Harness exceeded its 90 second deadline');
  process.exit(2);
}, 90_000);

const MAX_MODEL_CALLS = 8;
const MODEL = {
  id: 'harness-fixture',
  name: 'harness-fixture',
  api: 'openai-completions',
  provider: 'harness',
  baseUrl: 'http://127.0.0.1:9',
  reasoning: false,
  input: ['text'],
  contextWindow: 100_000,
  maxTokens: 4096,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

const conservativeConfig = {
  version: 1,
  actionFusion: true,
  observationPack: true,
  evidencePreservingReducer: false,
  evidencePreservingReducerModel: 'gpt-5.6-luna',
  evidencePreservingReducerProvider: 'openai-codex',
  onlineContextCompact: false,
  cacheWriteReadRatio: 12.5,
};

const jiti = createJiti(import.meta.url, { moduleCache: true });
const vendor = await jiti.import(
  path.join(repoRoot, 'src/main/libs/solPi/vendor/sol-pi/index.ts'),
);

/** Build the fake model runtime with a per-variant script and metrics. */
function makeModelRuntime(script, metrics) {
  return {
    registerProvider() {},
    setRuntimeApiKey: async () => {},
    getModel: () => MODEL,
    refresh: async () => ({}),
    hasConfiguredAuth: () => true,
    checkAuth: async () => ({ apiKey: 'fixture' }),
    isUsingOAuth: () => false,
    streamSimple: async (_model, context) => {
      metrics.modelCalls += 1;
      assert.ok(metrics.modelCalls <= MAX_MODEL_CALLS, 'Model call budget exceeded');
      metrics.contextBytesPerCall.push(
        context.messages.reduce((total, m) => {
          const text =
            typeof m.content === 'string'
              ? m.content
              : (m.content ?? [])
                  .map(block =>
                    block.type === 'text' ? block.text : JSON.stringify(block.arguments ?? ''),
                  )
                  .join('\n');
          return total + text.length;
        }, 0),
      );
      const next = script[metrics.modelCalls - 1];
      assert.ok(next, 'Model script exhausted before the session settled');
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: 'done', reason: 'stop', message: next };
        },
        async result() {
          return next;
        },
      };
    },
  };
}

const assistantText = text => ({
  role: 'assistant',
  content: [{ type: 'text', text }],
  stopReason: 'stop',
  api: MODEL.api,
  provider: MODEL.provider,
  model: MODEL.id,
  timestamp: Date.now(),
  usage: {
    input: 1,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 2,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
});

const assistantWithTools = (calls, text = '') => ({
  ...assistantText(text),
  content: [
    ...(text ? [{ type: 'text', text }] : []),
    ...calls.map((call, index) => ({
      type: 'toolCall',
      id: `call-${call.id ?? index + 1}`,
      name: call.name,
      arguments: call.arguments,
    })),
  ],
  stopReason: 'toolUse',
});

/** App-style then_run guard (static deny-list + scripted authorization). */
function thenRunGuard(denyCommands, pendingDecision) {
  return extensionApi => {
    extensionApi.on('tool_call', async event => {
      if (event.toolName !== 'edit' && event.toolName !== 'write') return undefined;
      const thenRun = event.input?.then_run;
      if (!thenRun || typeof thenRun !== 'object') return undefined;
      if (typeof thenRun.command !== 'string' || thenRun.command.length === 0) {
        return { block: true, reason: 'then_run.command must be a non-empty string.' };
      }
      if (pendingDecision) {
        // Hold the authorization open like a pending user approval, then
        // settle with the provided decision (mirrors the app resolving a
        // pending approval when the user stops the session).
        return pendingDecision(thenRun);
      }
      if (denyCommands.includes(thenRun.command)) {
        return { block: true, reason: 'The follow-up command was not approved.' };
      }
      return undefined;
    });
  };
}

async function runVariant({
  label,
  cwd,
  storageRoot,
  script,
  denyCommands,
  useSolPi,
  pendingDecision,
  onSession,
}) {
  const metrics = { modelCalls: 0, contextBytesPerCall: [], toolResults: 0, errors: [] };
  const agentDir = path.join(cwd, 'agent');
  await import('node:fs/promises').then(fs => fs.mkdir(agentDir, { recursive: true }));

  const extensionFactories = [];
  if (useSolPi) {
    extensionFactories.push(
      thenRunGuard(denyCommands, pendingDecision),
      vendor.createSolPiExtension(() => conservativeConfig),
    );
  }
  const resourceLoader = new pi.DefaultResourceLoader({
    cwd,
    agentDir,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    extensionFactories,
  });
  await resourceLoader.reload();

  let sessionManager = pi.SessionManager.inMemory(cwd);
  if (useSolPi) {
    // Mirror solPiSessionScope: expose the app-owned dir to SoL-Pi.
    sessionManager = Object.create(sessionManager);
    sessionManager.getSessionDir = () => path.join(storageRoot, 'harness-session');
  }

  const settled = new Promise((resolve, reject) => {
    pi
      .createAgentSession({
        cwd,
        agentDir,
        model: MODEL,
        modelRuntime: makeModelRuntime(script, metrics),
        resourceLoader,
        settingsManager: pi.SettingsManager.inMemory({
          compaction: { enabled: false },
          retry: { enabled: false },
        }),
        sessionManager,
      })
      .then(async ({ session }) => {
        // SDK sessions never emit session_start on their own; SoL-Pi needs it.
        if (useSolPi) {
          await session.bindExtensions({
            mode: 'print',
            onError: err => {
              metrics.errors.push({ content: [{ type: 'text', text: err.error }], isError: true });
            },
          });
        }
        session.subscribe(event => {
          if (event.type === 'message_end' && event.message?.role === 'toolResult') {
            metrics.toolResults += 1;
            if (event.message.isError) metrics.errors.push(event.message);
          }
          if (event.type === 'agent_settled') resolve();
          if (event.type === 'error') reject(new Error(event.message?.errorMessage ?? 'error'));
        });
        onSession?.(session);
        void session.prompt('Harness task.').catch(reject);
      })
      .catch(reject);
  });
  await settled;
  return { label, ...metrics };
}

const report = (variant) => ({
  label: variant.label,
  modelCalls: variant.modelCalls,
  toolResults: variant.toolResults,
  errorToolResults: variant.errors.length,
  contextBytesPerCall: variant.contextBytesPerCall,
});

async function scenarioFusion(baseDir) {
  // Same task, same intended work: write a file, run its check, answer.
  const baselineScript = [
    assistantWithTools([{ name: 'write', arguments: { path: 'fusion.txt', content: 'FUSION-OK\n' } }]),
    assistantWithTools([{ name: 'bash', arguments: { command: 'wc -c < fusion.txt' } }]),
    assistantText('baseline done'),
  ];
  const conservativeScript = [
    assistantWithTools([
      {
        name: 'write',
        arguments: {
          path: 'fusion.txt',
          content: 'FUSION-OK\n',
          then_run: { command: 'wc -c < fusion.txt' },
        },
      },
    ]),
    assistantText('conservative done'),
  ];
  const baselineCwd = mkdtempSync(path.join(baseDir, 'fusion-baseline-'));
  const conservativeCwd = mkdtempSync(path.join(baseDir, 'fusion-solpi-'));
  const baseline = await runVariant({
    label: 'fusion/baseline',
    cwd: baselineCwd,
    storageRoot: mkdtempSync(path.join(baseDir, 'fusion-store-')),
    script: baselineScript,
    denyCommands: [],
    useSolPi: false,
  });
  const conservative = await runVariant({
    label: 'fusion/conservative',
    cwd: conservativeCwd,
    storageRoot: mkdtempSync(path.join(baseDir, 'fusion-store-')),
    script: conservativeScript,
    denyCommands: [],
    useSolPi: true,
  });

  assert.equal(readFileSync(path.join(baselineCwd, 'fusion.txt'), 'utf8'), 'FUSION-OK\n');
  assert.equal(readFileSync(path.join(conservativeCwd, 'fusion.txt'), 'utf8'), 'FUSION-OK\n');
  // Mechanism claim only: the fused path needed one fewer model round-trip.
  assert.equal(baseline.modelCalls, 3);
  assert.equal(conservative.modelCalls, 2);
  assert.equal(baseline.errors.length, 0);
  assert.equal(conservative.errors.length, 0);
  return { baseline: report(baseline), conservative: report(conservative) };
}

async function scenarioDeniedThenRun(baseDir) {
  const cwd = mkdtempSync(path.join(baseDir, 'deny-'));
  const script = [
    assistantWithTools([
      {
        name: 'write',
        arguments: { path: 'never.txt', content: 'X', then_run: { command: 'rm -rf /denied' } },
      },
    ]),
    assistantText('adapted after denial'),
  ];
  const variant = await runVariant({
    label: 'deny/conservative',
    cwd,
    storageRoot: mkdtempSync(path.join(baseDir, 'deny-store-')),
    script,
    denyCommands: ['rm -rf /denied'],
    useSolPi: true,
  });
  // The fused call was blocked BEFORE the write: no file, one error tool result,
  // and the session still settled cleanly with the follow-up turn.
  assert.equal(existsSync(path.join(cwd, 'never.txt')), false);
  assert.equal(variant.errors.length, 1);
  assert.equal(variant.modelCalls, 2);
  return report(variant);
}

/** A pending then_run authorization that settles denied after a user stop. */
async function scenarioStopDuringPendingApproval(baseDir) {
  const cwd = mkdtempSync(path.join(baseDir, 'stop-'));
  const script = [
    assistantWithTools([
      {
        name: 'write',
        arguments: { path: 'stopped.txt', content: 'X', then_run: { command: 'echo stopped' } },
      },
    ]),
    assistantText('settled after stop'),
  ];
  // The authorization stays pending while the run is live; the user stop
  // aborts the session, and the app-side resolver then settles the pending
  // approval as denied (what pauseRun does in the real adapter).
  const pendingDecision = () =>
    new Promise(resolve => {
      setTimeout(() => resolve({ block: true, reason: 'The session was stopped by the user.' }), 150);
    });
  const variant = await runVariant({
    label: 'stop/conservative',
    cwd,
    storageRoot: mkdtempSync(path.join(baseDir, 'stop-store-')),
    script,
    denyCommands: [],
    useSolPi: true,
    pendingDecision,
    onSession: session => {
      setTimeout(() => void session.abort(), 50);
    },
  });
  // The fused write never executed: no file on disk, and the run settled
  // instead of hanging on the never-approved command.
  assert.equal(existsSync(path.join(cwd, 'stopped.txt')), false);
  assert.ok(variant.modelCalls <= 2, `unexpected model calls ${variant.modelCalls}`);
  return report(variant);
}

async function scenarioLargeObservation(baseDir) {
  // A 40 KB tool result that the model references in three later turns.
  const bigCommand = "awk 'BEGIN{s=\"\";for(i=0;i<1000;i++)s=s \"observation-line-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\n\";printf \"%s\",s}'";
  const turns = label => [
    assistantWithTools([{ name: 'bash', arguments: { command: bigCommand } }]),
    assistantWithTools([{ name: 'bash', arguments: { command: 'echo turn-2' } }]),
    assistantWithTools([{ name: 'bash', arguments: { command: 'echo turn-3' } }]),
    assistantText(`${label} done`),
  ];
  const baselineCwd = mkdtempSync(path.join(baseDir, 'obs-baseline-'));
  const conservativeCwd = mkdtempSync(path.join(baseDir, 'obs-solpi-'));
  const storageRoot = mkdtempSync(path.join(baseDir, 'obs-store-'));
  const baseline = await runVariant({
    label: 'obs/baseline',
    cwd: baselineCwd,
    storageRoot,
    script: turns('baseline'),
    denyCommands: [],
    useSolPi: false,
  });
  const conservative = await runVariant({
    label: 'obs/conservative',
    cwd: conservativeCwd,
    storageRoot,
    script: turns('conservative'),
    denyCommands: [],
    useSolPi: true,
  });
  // Mechanism claims: same settled run; from the 3rd model call on, the packed
  // projection carries far fewer bytes than the baseline replay.
  assert.equal(baseline.modelCalls, 4);
  assert.equal(conservative.modelCalls, 4);
  assert.equal(baseline.errors.length, 0);
  assert.equal(conservative.errors.length, 0);
  const baselineReplay = baseline.contextBytesPerCall[3];
  const packedReplay = conservative.contextBytesPerCall[3];
  assert.ok(
    packedReplay < baselineReplay / 2,
    `packed projection ${packedReplay} should be far below baseline ${baselineReplay}`,
  );
  // Original retained under the app-owned session directory.
  const objectsDir = path.join(storageRoot, 'harness-session', 'sol-pi');
  assert.ok(existsSync(objectsDir), 'SoL-Pi storage missing under app-owned root');
  return {
    baseline: report(baseline),
    conservative: report(conservative),
  };
}

const baseDir = mkdtempSync(path.join(tmpdir(), 'solpi-harness-'));
const results = {
  scope:
    'Offline mechanism harness: real pi-coding-agent 0.84.2, scripted fake model, no network. Measures structure (calls, projected context bytes, approval, stop), not real-model savings.',
  fusion: await scenarioFusion(baseDir),
  deniedThenRun: await scenarioDeniedThenRun(baseDir),
  stopDuringPendingApproval: await scenarioStopDuringPendingApproval(baseDir),
  largeObservation: await scenarioLargeObservation(baseDir),
};
rmSync(baseDir, { recursive: true, force: true });
clearTimeout(deadline);
console.log(JSON.stringify(results, null, 2));
console.log('HARNESS OK');
