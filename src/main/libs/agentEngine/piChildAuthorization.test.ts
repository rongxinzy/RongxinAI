import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai';
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux';
import {
  createRegistry,
  defineExtension,
  Harness,
  MemoryStorage,
} from '@earendil-works/pi-durable';
import { obj } from '@earendil-works/pi-schema';
import { expect, test, vi } from 'vitest';
import { WorkbenchApprovalMode } from '../../../shared/workbenchTask';
import { createDurableResourcePolicy } from './durableResourcePolicy';
import { executeDurableSubagent } from './durableSubagent.mjs';
import { toDurableTool } from './durableToolTypes';
import { PiToolPermissionGate } from './piToolPermissionGate';
import type { PiPermissionRequest } from './piRuntimeTypes';

const context = BACKGROUND_CONTEXT;

test.each([false, true])(
  'native owned child tools retain foreground authorization and read-only planning (plan=%s)',
  async planMode => {
    const faux = fauxProvider();
    const models = createModels();
    models.setProvider(faux.provider);
    const requests: PiPermissionRequest[] = [];
    const effects = vi.fn();
    const gate = new PiToolPermissionGate({
      approvalSessionMap: new Map(),
      getWorkbenchTaskService: () => null,
      stopActiveSession: vi.fn(),
      emit(event: string, ...args: unknown[]) {
        if (event !== 'permissionRequest') return;
        requests.push(args[1] as PiPermissionRequest);
        if (requests.length === 2) {
          gate.resolvePermission(requests[0].requestId, { behavior: 'allow' });
          gate.resolvePermission(requests[1].requestId, {
            behavior: 'deny',
            message: 'Denied child effect.',
          });
        }
      },
    });
    const effect = toDurableTool({
      name: 'effect',
      label: 'Effect',
      description: 'Perform an external effect.',
      parameters: obj({}),
      execute: async () => {
        effects();
        return { content: [{ type: 'text', text: 'Effect committed.' }] };
      },
    });
    const delegate = toDurableTool({
      name: 'subagent',
      label: 'Subagent',
      description: 'Delegate isolated work.',
      parameters: obj({}),
      annotations: { readOnlyHint: true, idempotentHint: true },
      execute: async () => {
        const results = await Promise.all(
          ['child-1', 'child-2'].map(key =>
            executeDurableSubagent({
              profile: { id: 'worker', systemPrompt: `Complete ${key}.` },
              task: key,
              key,
            }),
          ),
        );
        return {
          content: [{ type: 'text', text: results.map(result => result.output).join('\n') }],
        };
      },
    });
    const tools = [effect, delegate];
    const active = {
      planMode,
      piSession: { getToolDefinition: (name: string) => tools.find(tool => tool.name === name) },
    };
    const registry = createRegistry();
    registry.install(defineExtension({ name: 'test.child-tools', tools }));
    registry.install(
      createDurableResourcePolicy(
        {
          activeSessions: new Map([['root', active]]),
          authorizeToolCall: gate.authorizeToolCall.bind(gate),
        } as never,
        {
          sessionId: 'root',
          getRunId: () => 'run',
          getApprovalMode: () => WorkbenchApprovalMode.Ask,
        },
      ),
    );
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall('subagent', {}, { id: 'parent-call' }), {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage(fauxToolCall('effect', {}, { id: 'same-provider-id' }), {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage(fauxToolCall('effect', {}, { id: 'same-provider-id' }), {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage('Child finished.'),
      fauxAssistantMessage('Other child finished.'),
      fauxAssistantMessage('Parent finished.'),
    ]);
    const harness = await Harness.open(new MemoryStorage(), { models, registry }, context);
    try {
      const model = faux.getModel();
      const parent = await harness.root(context, {
        agent: { model: { provider: model.provider, modelId: model.id } },
      });
      const submission = await parent.submit({ type: 'input', content: 'Delegate both.' }, context);
      expect((await submission.wait(context)).status).toBe('done');
      expect(requests).toHaveLength(planMode ? 0 : 2);
      expect(effects).toHaveBeenCalledTimes(planMode ? 0 : 1);
      if (!planMode) {
        expect(requests.map(request => request.toolUseId)).toEqual([
          'same-provider-id',
          'same-provider-id',
        ]);
        expect(new Set(requests.map(request => request.requestId)).size).toBe(2);
      }
      const conversations = await harness.commit(tx => tx.scanConversations({}, 10), context);
      expect(conversations.items).toHaveLength(3);
      expect(
        conversations.items.filter(
          conversation => conversation.owner?.conversationId === parent.id,
        ),
      ).toHaveLength(2);
    } finally {
      await harness.close(context);
    }
  },
);
