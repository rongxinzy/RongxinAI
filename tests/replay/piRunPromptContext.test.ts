import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { app } from 'electron';
import { expect, test, vi } from 'vitest';

import { CoworkStore } from '../../src/main/coworkStore';
import { PiRuntimeAdapter } from '../../src/main/libs/agentEngine/piRuntimeAdapter';
import type { ProjectMemoryService } from '../../src/main/memory/projectMemoryService';
import { SqliteStore } from '../../src/main/sqliteStore';
import { CoworkExecutionMode, CoworkSessionMode } from '../../src/shared/cowork/constants';
import { PiRunEvent } from '../../src/shared/cowork/runState';
import {
  DeliveryMode,
  PayloadKind,
  ScheduleKind,
  SessionTarget,
  TaskStatus,
  WakeMode,
} from '../../src/scheduledTask/constants';
import { ScheduledTaskResultGuidance } from '../../src/scheduledTask/enginePrompt';
import { PiScheduledTaskExecutor } from '../../src/scheduledTask/piScheduledTaskExecutor';
import type { ScheduledTask, ScheduledTaskRun } from '../../src/scheduledTask/types';
import { installTestMagpie } from '../helpers/installTestMagpie';

const mutableApp = app as unknown as Record<string, unknown>;
if (typeof mutableApp.getAppPath !== 'function') mutableApp.getAppPath = () => process.cwd();

type CapturedMessage = { role: string; content: unknown };

type PromptContext = {
  adapter: PiRuntimeAdapter;
  directory: string;
  store: CoworkStore;
  systemPrompts: string[];
  requestMessages: CapturedMessage[][];
};

function messageText(message: CapturedMessage): string {
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .filter((part): part is { type?: string; text?: string } =>
        Boolean(part && typeof part === 'object'),
      )
      .map(part => (typeof part.text === 'string' ? part.text : ''))
      .join('\n');
  }
  return '';
}

async function withPiPromptContext(
  run: (context: PromptContext) => Promise<void>,
  tokensForRequest: (requestCount: number) => number = () => 100,
): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), 'pi-run-prompt-'));
  const model = 'offline-prompt-context';
  const systemPrompts: string[] = [];
  const requestMessages: CapturedMessage[][] = [];
  const upstream = createServer(async (request, response) => {
    const body: Buffer[] = [];
    for await (const chunk of request) body.push(Buffer.from(chunk));
    const { messages } = JSON.parse(Buffer.concat(body).toString('utf8')) as {
      messages: CapturedMessage[];
    };
    requestMessages.push(messages);
    systemPrompts.push(
      messages
        .filter(message => message.role === 'system' || message.role === 'developer')
        .map(messageText)
        .join('\n'),
    );
    const promptTokens = tokensForRequest(systemPrompts.length);
    const chunk = (delta: object, finishReason: string | null, usage?: object) =>
      `data: ${JSON.stringify({
        id: 'offline',
        object: 'chat.completion.chunk',
        model,
        choices: [{ index: 0, delta, finish_reason: finishReason }],
        usage,
      })}\n\n`;
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(
      chunk({ role: 'assistant', content: 'Local test response.' }, null) +
        chunk({}, 'stop', {
          prompt_tokens: promptTokens,
          completion_tokens: 2,
          total_tokens: promptTokens + 2,
        }) +
        'data: [DONE]\n\n',
    );
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const gateway = installTestMagpie({
    gatewayUrl: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`,
    defaultModelId: model,
  });
  gateway.upsert(model, { context_window: 65_536, max_output_tokens: 4_096 });
  let database: SqliteStore | undefined;
  const adapter = new PiRuntimeAdapter();
  adapter.setPiSessionStoreRoot(directory);
  const error = vi.fn();
  adapter.on('error', error);
  try {
    database = await SqliteStore.create(directory);
    const store = new CoworkStore(database.getDatabase());
    adapter.setCoworkStore(store);
    await run({ adapter, directory, store, systemPrompts, requestMessages });
    expect(error).not.toHaveBeenCalled();
  } finally {
    adapter.stopAllSessions();
    gateway.dispose();
    database?.close();
    await new Promise<void>(resolve => {
      upstream.close(() => resolve());
      upstream.closeAllConnections();
    });
    await rm(directory, { recursive: true, force: true });
  }
}

test(
  'the native request keeps system prompt immutable and preserves revised memory across preflight compaction',
  { timeout: 60_000 },
  async () => {
    await withPiPromptContext(
      async ({ adapter, directory, store, systemPrompts, requestMessages }) => {
        const oldFact = 'Original internal release sequence is peach-tulip.';
        const revisedFact = 'Current internal release sequence is lime-dahlia.';
        const otherFact = 'The incident labels use stable names.';
        const projectFact = (content: string) => `Workspace:\n- [memory:41] ${content}`;
        const currentPrompt = 'Repeat the current internal release sequence after compaction.';
        const firstPrompt = 'Read the original internal release sequence.';
        const secondPrompt = 'Confirm the revised internal release sequence.';
        const session = store.createSession(
          'Memory test',
          directory,
          '',
          CoworkExecutionMode.Local,
        );
        const completedCompactionAt: number[] = [];
        adapter.on('executionEvent', (_sessionId, event) => {
          if (event.type === PiRunEvent.CompactEnd && 'result' in event && event.result) {
            completedCompactionAt.push(systemPrompts.length);
          }
        });
        const buildProjectContext: ProjectMemoryService['buildProjectContext'] = vi.fn(
          async ({ query }) => {
            if (query === firstPrompt) return `${projectFact(oldFact)}\n- [memory:42] ${otherFact}`;
            if (query === currentPrompt) {
              const settings = adapter.activeSessions.get(session.id)?.settingsManager;
              expect(settings).toBeDefined();
              // Apply pressure only after recall starts, so native compaction runs
              // between receipt of the unchanged fact and before_agent_start.
              settings?.applyOverrides({
                compaction: { reserveTokens: 29_000, keepRecentTokens: 300 },
              });
            }
            return projectFact(revisedFact);
          },
        );
        adapter.setProjectMemoryService({ buildProjectContext } as ProjectMemoryService);
        await adapter.startSession(session.id, firstPrompt, {
          workspaceRoot: directory,
          sessionMode: 'work',
          confirmationMode: 'modal',
        });
        const req0Text = requestMessages[0].map(messageText).join('\n');
        expect(req0Text).toContain(oldFact);
        expect(req0Text).toContain(otherFact);
        await adapter.continueSession(session.id, secondPrompt);

        expect(systemPrompts).toHaveLength(2);
        // System prompt at position 0 must remain byte-identical for KV cache hit across turns.
        expect(systemPrompts[1]).toBe(systemPrompts[0]);
        await adapter.continueSession(session.id, currentPrompt);

        expect(completedCompactionAt).toEqual([3]);
        expect(systemPrompts).toHaveLength(4);
        expect(systemPrompts[3]).toBe(systemPrompts[0]);

        const req1InjectedMemory = requestMessages[1]
          .slice(requestMessages[0].length)
          .filter(message => messageText(message).includes('Relevant memory'))
          .map(messageText)
          .join('\n');
        expect.soft(req1InjectedMemory).toContain(revisedFact);
        expect.soft(req1InjectedMemory).not.toContain(otherFact);
        expect.soft(req1InjectedMemory).not.toContain(oldFact);
        expect.soft(req1InjectedMemory.match(/Relevant memory/g)).toHaveLength(1);
        expect(requestMessages[1].map(messageText).join('\n')).toContain(otherFact);

        const req3InjectedMemory = messageText(requestMessages[3].at(-1)!);
        expect(req3InjectedMemory).toContain(revisedFact);
        expect(req3InjectedMemory).not.toContain(otherFact);
        expect(req3InjectedMemory).not.toContain(oldFact);
        expect(buildProjectContext).toHaveBeenCalledTimes(3);
      },
      requestCount => (requestCount === 2 ? 45_000 : 100),
    );
  },
);

test.each(['stored', 'active'] as const)(
  'binds scheduled result guidance to the Cron submission on a %s Work session',
  { timeout: 60_000 },
  async state => {
    await withPiPromptContext(async ({ adapter, directory, store, systemPrompts }) => {
      const expertDirective = 'Apply the audited liquidity method before presenting conclusions.';
      const session = store.createSession(
        'Liquidity review',
        directory,
        expertDirective,
        CoworkExecutionMode.Local,
      );
      const sessionOptions = {
        workspaceRoot: directory,
        sessionMode: CoworkSessionMode.Work,
        systemPrompt: expertDirective,
      };
      if (state === 'active') {
        await adapter.startSession(session.id, 'Open the liquidity review.', sessionOptions);
      }
      const task: ScheduledTask = {
        id: 'liquidity-task',
        name: 'Liquidity review',
        description: '',
        enabled: true,
        schedule: { kind: ScheduleKind.Every, everyMs: 60_000 },
        sessionTarget: SessionTarget.Main,
        wakeMode: WakeMode.NextHeartbeat,
        payload: {
          kind: PayloadKind.AgentTurn,
          message: 'Produce the scheduled liquidity result.',
        },
        delivery: { mode: DeliveryMode.None },
        workspaceId: null,
        sessionKey: session.id,
        state: {
          nextRunAtMs: null,
          lastRunAtMs: null,
          lastStatus: null,
          lastError: null,
          lastDurationMs: null,
          runningAtMs: null,
          consecutiveErrors: 0,
        },
        createdAt: '',
        updatedAt: '',
      };
      const run: ScheduledTaskRun = {
        id: 'liquidity-run',
        taskId: task.id,
        sessionId: session.id,
        sessionKey: task.sessionKey,
        status: TaskStatus.Running,
        startedAt: '',
        finishedAt: null,
        durationMs: null,
        error: null,
      };

      const cronRequestIndex = systemPrompts.length;
      await expect(new PiScheduledTaskExecutor(adapter, store).execute(task, run)).resolves.toEqual(
        {
          sessionId: session.id,
          output: 'Local test response.',
        },
      );

      await adapter.continueSession(session.id, 'Discuss the liquidity conclusion.');
      expect(systemPrompts).toHaveLength(cronRequestIndex + 2);
      const [cronRequest, interactiveRequest] = systemPrompts.slice(cronRequestIndex);
      expect(cronRequest).toContain(expertDirective);
      expect(cronRequest.split(ScheduledTaskResultGuidance)).toHaveLength(2);
      expect(interactiveRequest).toContain(expertDirective);
      expect(interactiveRequest).not.toContain(ScheduledTaskResultGuidance);
      expect(store.getSession(session.id, 0, { includeArtifacts: false })?.systemPrompt).toBe(
        expertDirective,
      );
    });
  },
);
