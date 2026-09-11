/**
 * Shared fixtures for SoL-Pi tests: a jiti loader for the vendored upstream
 * source (the same loading strategy as production) plus a minimal fake
 * ExtensionAPI/ExtensionContext that captures registrations and events.
 */
import { createJiti } from 'jiti';
import path from 'node:path';

export interface FakeToolDefinition {
  name: string;
  parameters: Record<string, unknown>;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: unknown,
  ) => Promise<{ content: Array<{ type: string; text?: string }>; details?: unknown }>;
  renderCall?: (args: unknown, theme: unknown, context: unknown) => unknown;
  renderResult?: (result: unknown, options: unknown, theme: unknown, context: unknown) => unknown;
}

export type FakeToolCallHandler = (
  event: { type: 'tool_call'; toolCallId: string; toolName: string; input?: unknown },
) => { block: boolean; reason: string } | undefined | Promise<{ block: boolean; reason: string } | undefined>;

export class FakeExtensionApi {
  readonly tools = new Map<string, FakeToolDefinition>();
  readonly toolCallHandlers: FakeToolCallHandler[] = [];
  readonly contextHandlers: Array<
    (
      event: { messages: unknown[] },
      ctx?: unknown,
    ) => Promise<{ messages: unknown[] } | void>
  > = [];
  readonly sessionStartHandlers: Array<
    (event: { type: 'session_start' }, ctx: unknown) => void | Promise<void>
  > = [];

  registerTool(tool: FakeToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  on(event: 'tool_call', handler: FakeToolCallHandler): void;
  on(event: 'context', handler: (event: { messages: unknown[] }, ctx?: unknown) => Promise<{ messages: unknown[] } | void>): void;
  on(event: 'session_start', handler: (event: { type: 'session_start' }, ctx: unknown) => void | Promise<void>): void;
  on(event: string, handler: unknown): void {
    if (event === 'tool_call') {
      this.toolCallHandlers.push(handler as FakeToolCallHandler);
    } else if (event === 'context') {
      this.contextHandlers.push(
        handler as (
          event: { messages: unknown[] },
          ctx?: unknown,
        ) => Promise<{ messages: unknown[] } | void>,
      );
    } else if (event === 'session_start') {
      this.sessionStartHandlers.push(
        handler as (event: { type: 'session_start' }, ctx: unknown) => void | Promise<void>,
      );
    }
  }

  /** Fire the registered session_start handlers (upstream registers on start). */
  async emitSessionStart(ctx: unknown): Promise<void> {
    for (const handler of this.sessionStartHandlers) {
      await handler({ type: 'session_start' }, ctx);
    }
  }

  /** Mirror Pi's emitToolCall: first blocking handler wins. */
  async emitToolCall(event: {
    toolCallId: string;
    toolName: string;
    input?: unknown;
  }): Promise<{ block: boolean; reason: string } | undefined> {
    let result: { block: boolean; reason: string } | undefined;
    for (const handler of this.toolCallHandlers) {
      const handlerResult = await handler({ type: 'tool_call', ...event });
      if (handlerResult) {
        result = handlerResult;
        if (result.block) return result;
      }
    }
    return result;
  }

  /** Mirror Pi's chained context projection; handlers also receive the ctx. */
  async emitContext(messages: unknown[], ctx: unknown): Promise<unknown[]> {
    let current = messages;
    for (const handler of this.contextHandlers) {
      const result = await handler({ messages: current }, ctx);
      if (result && result.messages) current = result.messages;
    }
    return current;
  }
}

export interface FakeExtensionContext {
  cwd: string;
  sessionManager: {
    getSessionDir(): string;
    getSessionId(): string;
    getSessionFile(): string | null;
  };
}

export function createFakeExtensionContext(
  cwd: string,
  sessionDir: string,
): FakeExtensionContext {
  return {
    cwd,
    sessionManager: {
      getSessionDir: () => sessionDir,
      getSessionId: () => 'test-session-0001',
      getSessionFile: () => null,
    },
  };
}

/** Load a module from the vendored SoL-Pi tree via jiti (as production does). */
export function loadVendorModule<T>(relativePath: string): Promise<T> {
  const jiti = createJiti(__filename, { moduleCache: true });
  const entry = path.resolve(__dirname, 'vendor/sol-pi', relativePath);
  return jiti.import(entry) as Promise<T>;
}
