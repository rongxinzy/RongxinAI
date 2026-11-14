import type { Op } from '@earendil-works/chord/delta';
import type {
  ConversationView,
  EntryRecord,
  LiveState,
  NestedToolSlot,
  ToolSlot,
} from '@earendil-works/pi-durable';
import type { PiEvent } from './piRuntimeSessionState.js';

type Message = NonNullable<PiEvent['message']>;

/** Projects committed Durable deltas onto the application's existing UI event contract. */
export class DurableEventProjector {
  private readonly seen = new Set<number>();
  private readonly tools = new Map<string, string>();
  private readonly endedTools = new Set<string>();
  private readonly compactions = new Set<number>();
  private busy = false;
  private generation = '';
  private retryAttempt = '';
  private assistant: Message | undefined;
  readonly messages: Message[] = [];

  constructor(private readonly emit: (event: PiEvent) => void) {}

  seed(view: ConversationView): void {
    this.seen.clear();
    this.tools.clear();
    this.endedTools.clear();
    this.compactions.clear();
    this.assistant = undefined;
    this.messages.length = 0;
    this.busy = false;
    this.generation = '';
    this.retryAttempt = '';
    for (const entry of view.entries) this.seen.add(entry.id);
    for (const entry of view.entries) {
      for (const model of entry.model ?? []) this.messages.push(model as unknown as Message);
    }
  }

  advance(view: ConversationView, ops: readonly Op[]): void {
    const live = view.docs['pi.live'] as unknown as LiveState | undefined;
    const busy = Boolean(live?.run);
    if (busy && !this.busy) this.emit({ type: 'agent_start' });
    for (const entry of view.entries) {
      if (this.seen.has(entry.id)) continue;
      this.seen.add(entry.id);
      this.entry(entry);
    }
    if (this.seen.size > 1024) {
      this.seen.clear();
      for (const entry of view.entries) this.seen.add(entry.id);
    }
    if (live) this.live(live, ops);
    else this.compactions.clear();
    const currentTools = new Set(
      [...(live?.tools ?? []), ...(live?.nestedTools ?? [])].map(slot => slot.callId),
    );
    for (const id of this.tools.keys()) if (!currentTools.has(id)) this.tools.delete(id);
    for (const id of this.endedTools) if (!currentTools.has(id)) this.endedTools.delete(id);
    if (!busy && this.busy) {
      if (live?.runFailure && live.runFailure.reason !== 'aborted') {
        this.emit({
          type: 'message_end',
          message: {
            role: 'assistant',
            content: [],
            stopReason: 'error',
            errorMessage: live.runFailure.detail ?? live.runFailure.reason,
          },
        });
      }
      this.emit({ type: 'agent_end' });
      this.emit({ type: 'agent_settled' });
      this.generation = '';
      this.retryAttempt = '';
    }
    this.busy = busy;
  }

  private entry(entry: EntryRecord): void {
    for (const model of entry.model ?? []) {
      const message = { ...model, id: String(entry.id) } as unknown as Message;
      if (model.role === 'assistant' && model.stopReason === 'length') {
        message.stopReason = 'error';
        message.errorMessage =
          'Model response reached its output token limit; completion is incomplete.';
      }
      this.messages.push(message);
      if (this.messages.length > 100) this.messages.shift();
      if (model.role === 'user') {
        this.emit({ type: 'message_start', message });
        this.emit({ type: 'message_end', message });
      } else if (model.role === 'assistant') {
        for (const block of model.content) {
          if (block.type !== 'toolCall') continue;
          this.tools.delete(block.id);
          this.endedTools.delete(block.id);
        }
        if (!this.generation) {
          this.emit({ type: 'turn_start' });
          this.emit({ type: 'message_start', message: { ...message, content: [] } });
        }
        this.assistant = message;
        this.emit({ type: 'message_end', message });
        this.generation = '';
      } else if (model.role === 'toolResult') {
        this.startTool(model.toolCallId, model.toolName);
        if (!this.endedTools.has(model.toolCallId))
          this.emit({
            type: 'tool_execution_end',
            toolCallId: model.toolCallId,
            toolName: model.toolName,
            result: { content: model.content, details: model.details },
            isError: model.isError,
          });
        this.endedTools.add(model.toolCallId);
        this.tools.delete(model.toolCallId);
      }
    }
    if (entry.kind === 'pi.compaction') {
      this.emit({ type: 'compaction_end', success: true, result: entry.data });
    }
  }

  private live(live: LiveState, ops: readonly Op[]): void {
    const message = live.generation?.message;
    if (message) {
      const key = `${live.run?.taskId}:${live.generation?.attempt}`;
      const nextMessage = message as unknown as Message;
      if (key !== this.generation) {
        this.generation = key;
        this.emit({ type: 'turn_start' });
        this.emit({ type: 'message_start', message: { ...nextMessage, content: [] } });
        this.emit({ type: 'message_update', message: nextMessage });
      } else {
        let appended = false;
        let replaced = false;
        for (const op of ops) {
          if (op[0] === 'r') {
            replaced = true;
            continue;
          }
          const path = op[1];
          if (
            path[0] !== 'docs' ||
            path[1] !== 'pi.live' ||
            path[2] !== 'generation' ||
            path[3] !== 'message'
          )
            continue;
          if (
            op[0] === 'a' &&
            path[4] === 'content' &&
            typeof path[5] === 'number' &&
            (path[6] === 'text' || path[6] === 'thinking')
          ) {
            appended = true;
            this.emit({
              type: 'message_update',
              message: nextMessage,
              assistantMessageEvent: {
                type: path[6] === 'thinking' ? 'thinking_delta' : 'text_delta',
                contentIndex: path[5],
                delta: op[2],
              },
            });
          } else if (op[0] !== 'a') replaced = true;
        }
        if (replaced || !appended) this.emit({ type: 'message_update', message: nextMessage });
      }
      this.assistant = nextMessage;
    }
    for (const slot of live.tools ?? []) this.tool(slot);
    for (const slot of live.nestedTools ?? []) this.tool(slot);
    const currentCompactions = new Set<number>(
      (live.compactions ?? []).map(compaction => compaction.taskId),
    );
    for (const id of this.compactions) if (!currentCompactions.has(id)) this.compactions.delete(id);
    for (const compaction of live.compactions ?? []) {
      if (!this.compactions.has(compaction.taskId)) {
        this.compactions.add(compaction.taskId);
        this.emit({ type: 'compaction_start', reason: compaction.trigger });
      }
    }
    if (live.generation?.retry) {
      const attempt = `${live.run?.taskId}:${live.generation.attempt}`;
      if (this.retryAttempt !== attempt) {
        this.retryAttempt = attempt;
        this.emit({
          type: 'auto_retry_start',
          attempt: live.generation.attempt,
          errorMessage: live.generation.retry.error,
        });
      }
    }
  }

  private startTool(id: string, name: string, fallbackArgs: unknown = {}): void {
    if (this.tools.has(id) || this.endedTools.has(id)) return;
    const blocks = this.assistant?.content;
    const call = Array.isArray(blocks) ? blocks.find(block => block.id === id) : undefined;
    this.emit({
      type: 'tool_execution_start',
      toolCallId: id,
      toolName: name,
      args: call?.arguments ?? fallbackArgs,
    });
    this.tools.set(id, '');
  }

  private tool(slot: ToolSlot | NestedToolSlot): void {
    if (this.endedTools.has(slot.callId)) return;
    const state = `${slot.status}:${slot.output ?? ''}`;
    if (this.tools.get(slot.callId) === state) return;
    this.startTool(slot.callId, slot.name, 'arguments' in slot ? slot.arguments : {});
    if (slot.status === 'done') {
      this.emit({
        type: 'tool_execution_end',
        toolCallId: slot.callId,
        toolName: slot.name,
        result: { content: [{ type: 'text', text: slot.output ?? '' }], details: slot.details },
        isError:
          'summary' in slot
            ? slot.summary?.isError
            : slot.diagnostics?.some(item => item.severity === 'error'),
      });
      this.endedTools.add(slot.callId);
      this.tools.delete(slot.callId);
      return;
    }
    this.tools.set(slot.callId, state);
    if (slot.output !== undefined || slot.details !== undefined)
      this.emit({
        type: 'tool_execution_update',
        toolCallId: slot.callId,
        toolName: slot.name,
        partialResult: {
          content: [{ type: 'text', text: slot.output ?? '' }],
          details: slot.details,
        },
      });
  }
}
