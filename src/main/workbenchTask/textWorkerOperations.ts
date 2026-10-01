import { boundWorkerInput } from './boundedWorkerInput';
import { CoworkRunPolicy } from '../../shared/cowork/runState';

export const TextWorkerKind = { Content: 'content', Tool: 'tool' } as const;
export type TextWorkerInput =
  | { kind: 'content'; content: string; previous: string; reset: boolean }
  | { kind: 'tool'; result: unknown };
export type TextWorkerOutput = { content: string; offset: number; truncated: boolean };

/** Bound structured-clone cost before crossing the worker boundary. No serialization on main. */
export function boundToolResult(value: unknown): unknown {
  return boundWorkerInput(value, {
    nodes: 512,
    depth: 8,
    characters: CoworkRunPolicy.MaximumContentCharacters,
    toolText: true,
  });
}

export function runTextWorkerOperation(input: TextWorkerInput): TextWorkerOutput {
  if (input.kind === TextWorkerKind.Content) {
    const content = input.content.slice(0, CoworkRunPolicy.MaximumContentCharacters);
    const offset = !input.reset && content.startsWith(input.previous) ? input.previous.length : 0;
    return {
      content: content.slice(offset),
      offset,
      truncated: content.length < input.content.length,
    };
  }
  const extract = (result: unknown): string => {
    if (result === undefined || result === null) return '';
    if (typeof result === 'string') return result;
    if (Array.isArray(result)) return result.map(extract).filter(Boolean).join('\n');
    if (typeof result === 'object') {
      const record = result as Record<string, unknown>;
      if (typeof record.text === 'string') return record.text;
      if (typeof record.content === 'string') return record.content;
      if (Array.isArray(record.content)) return extract(record.content);
      return JSON.stringify(result);
    }
    return String(result);
  };
  const text = extract(input.result);
  return {
    content: text.slice(0, CoworkRunPolicy.MaximumContentCharacters),
    offset: 0,
    truncated: text.length > CoworkRunPolicy.MaximumContentCharacters,
  };
}
