import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtureRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/glm-replay');

export interface GlmReplayLine {
  readonly t: number;
  readonly e: Record<string, unknown>;
}

export function loadGlmReplayFixture(relativePath: string): GlmReplayLine[] {
  const absolute = resolve(fixtureRoot, relativePath);
  const lines = readFileSync(absolute, 'utf8').split('\n').filter(Boolean);
  return lines.map(line => JSON.parse(line) as GlmReplayLine);
}

export function glmReplayEvents(relativePath: string): unknown[] {
  return loadGlmReplayFixture(relativePath).map(line => line.e);
}

export function expectedFinalAssistantText(events: readonly unknown[]): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index] as {
      type?: string;
      message?: { role?: string; stopReason?: string; content?: unknown };
    };
    if (event.type !== 'message_end' || event.message?.role !== 'assistant') continue;
    if (event.message.stopReason !== 'stop' && event.message.stopReason !== 'end_turn') continue;
    const content = event.message.content;
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) continue;
    return content
      .filter(
        block => block && typeof block === 'object' && (block as { type?: string }).type === 'text',
      )
      .map(block => (block as { text?: string }).text ?? '')
      .join('');
  }
  return '';
}
