import {
  AssistantEntry,
  configure,
  defineDoc,
  type ConversationId,
  type ToolRegistration,
} from '@earendil-works/pi-durable';
import { getDurableInvocation } from './durableInvocation.mjs';
import { PiSubagentProfileId, PiSubagentTerminationReason } from './piSubagentConstants.js';
import type { PiSubagentChildToolEvent } from './piSubagentConstants.js';
import { observeDurableChildActivity } from './durableChildActivity.mjs';

const Children = defineDoc<{ children: Record<string, number> }>({
  kind: 'zhiyuan.subagent.children',
  version: 1,
  scope: 'task',
  initial: () => ({ children: {} }),
  checkpointWhen: () => true,
});

interface ChildRequest {
  profile: { id: string; systemPrompt: string };
  task: string;
  key: string;
  signal?: AbortSignal;
  parentToolCallId?: string;
  onChildToolActivity?: (event: PiSubagentChildToolEvent) => void;
}

/** A child and its receipt are owned by the native tool task, including across restarts. */
export async function executeDurableSubagent(request: ChildRequest) {
  const { api, context } = getDurableInvocation();
  request.signal?.throwIfAborted();
  const parent = await api.agent(context);
  const readonly = new Set<string>([
    PiSubagentProfileId.Scout,
    PiSubagentProfileId.Planner,
    PiSubagentProfileId.Reviewer,
  ]).has(request.profile.id);
  const allowed = readonly ? new Set(['read', 'grep', 'find', 'ls']) : null;
  const forbidden = new Set([
    'subagent',
    'ask_user_question',
    'AskUserQuestion',
    'session_summary',
    'memory',
  ]);
  const permitted = new Set(
    parent.callable
      .filter(tool => !forbidden.has(tool.name) && (!allowed || allowed.has(tool.name)))
      .map(tool => tool.name),
  );
  const tools: ToolRegistration[] = api.registry
    .tools()
    .map(({ tool }) => tool)
    .filter(tool => permitted.has(tool.name));
  const childId = await api.commit(async tx => {
    const state = await tx.doc(Children, api.taskId);
    const existing = state.children[request.key];
    if (existing !== undefined) return existing as ConversationId;
    const created = await tx.createConversation({
      ownership: { kind: 'task', taskId: api.taskId },
    });
    await configure(tx, created.id, {
      instructions: request.profile.systemPrompt,
      tools,
      modelTools: tools.filter(tool => tool.callers?.includes('model') !== false),
    });
    state.children[request.key] = created.id;
    return created.id;
  }, context);
  await api.details({ agent: request.profile.id, conversationId: childId }, context);
  const child = await api.conversation(childId, context);
  if (!child) throw new Error('Owned child conversation is unavailable.');
  const started = Date.now();
  const stopObserving = await observeDurableChildActivity(
    childId,
    context,
    request.parentToolCallId ?? String(api.taskId),
    request.onChildToolActivity,
  );
  try {
    const submission = await child.submit(
      {
        type: 'input',
        content: request.task,
        requestId: `child:${api.taskId}:${request.key}`,
      },
      context,
    );
    const settled = await submission.wait(context);
    request.signal?.throwIfAborted();
    if (settled.status !== 'done' || settled.type === 'write')
      throw new Error(
        settled.status === 'unanswered' ? settled.reason : 'Child returned no answer.',
      );
    const answer = await api.commit(tx => tx.entry(AssistantEntry, settled.answer), context);
    if (
      answer?.model?.some(
        message => message.role === 'assistant' && message.stopReason === 'length',
      )
    )
      throw new Error('Child response reached its output token limit; completion is incomplete.');
    const output =
      answer?.model
        ?.flatMap(message =>
          message.role === 'assistant'
            ? message.content.flatMap(block => (block.type === 'text' ? [block.text] : []))
            : [],
        )
        .join('\n') ?? '';
    const history = await api.commit(
      tx => tx.scanEntries({ conversationId: childId }, 1000),
      context,
    );
    const messages = history.items.flatMap(entry => entry.model ?? []);
    return {
      ok: true,
      output,
      execution: {
        terminationReason: PiSubagentTerminationReason.Settled,
        durationMs: Date.now() - started,
        assistantTurns: messages.filter(message => message.role === 'assistant').length,
        toolCalls: messages.filter(message => message.role === 'toolResult').length,
      },
    };
  } finally {
    await stopObserving();
  }
}
