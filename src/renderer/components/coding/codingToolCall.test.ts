import { describe, expect, test } from 'vitest';

import { CodingEventKind } from '../../../shared/codingAgent';
import {
  hasToolCallDetails,
  isToolCallEvent,
  parsePlanEntries,
  parseToolCallView,
} from './codingToolCall';

describe('parseToolCallView', () => {
  test('extracts every ACP tool_call field', () => {
    const view = parseToolCallView({
      toolCallId: 'call-1',
      title: 'Edit src/app.ts',
      kind: 'edit',
      status: 'completed',
      locations: [{ path: 'src/app.ts', line: 12 }, { path: 'src/util.ts' }],
      content: [
        { type: 'diff', path: 'src/app.ts', oldText: 'a', newText: 'b' },
        { type: 'content', content: { type: 'text', text: 'Edited successfully.' } },
        { type: 'terminal', terminalId: 'term-1' },
      ],
      rawInput: { path: 'src/app.ts' },
      rawOutput: 'done',
    });

    expect(view).toEqual({
      title: 'Edit src/app.ts',
      kind: 'edit',
      status: 'completed',
      locations: [
        { path: 'src/app.ts', line: 12 },
        { path: 'src/util.ts', line: null },
      ],
      diffs: [{ path: 'src/app.ts', oldText: 'a', newText: 'b' }],
      output: 'Edited successfully.',
      rawInput: '{\n  "path": "src/app.ts"\n}',
      rawOutput: 'done',
    });
    expect(hasToolCallDetails(view)).toBe(true);
  });

  test('falls back to name and toolName when title is missing', () => {
    expect(parseToolCallView({ name: 'bash' }).title).toBe('bash');
    expect(parseToolCallView({ toolName: 'read_file' }).title).toBe('read_file');
  });

  test('returns an empty view for a minimal payload', () => {
    const view = parseToolCallView({ toolCallId: 'call-1', status: 'pending' });
    expect(view).toEqual({
      title: null,
      kind: null,
      status: 'pending',
      locations: [],
      diffs: [],
      output: null,
      rawInput: null,
      rawOutput: null,
    });
    expect(hasToolCallDetails(view)).toBe(false);
  });

  test('ignores malformed locations and diff entries', () => {
    const view = parseToolCallView({
      locations: [{ path: 42 }, { line: 3 }, { path: 'a.ts', line: -1 }],
      content: [
        { type: 'diff', oldText: 'a', newText: 'b' },
        { type: 'diff', path: 'b.ts' },
      ],
    });
    expect(view.locations).toEqual([{ path: 'a.ts', line: null }]);
    expect(view.diffs).toEqual([{ path: 'b.ts', oldText: '', newText: '' }]);
  });

  test('truncates oversized raw fields', () => {
    const view = parseToolCallView({ rawOutput: 'x'.repeat(30_000) });
    expect(view.rawOutput).toHaveLength(20_002);
    expect(view.rawOutput?.endsWith('…')).toBe(true);
  });

  test('drops empty raw values', () => {
    expect(parseToolCallView({ rawInput: '', rawOutput: null }).rawInput).toBeNull();
  });
});

describe('parsePlanEntries', () => {
  test('parses entries with status and priority', () => {
    expect(
      parsePlanEntries({
        entries: [
          { content: 'Scan the codebase', status: 'completed', priority: 'high' },
          { content: 'Write tests', status: 'in_progress' },
          { content: 'Ship it' },
        ],
      }),
    ).toEqual([
      { content: 'Scan the codebase', status: 'completed', priority: 'high' },
      { content: 'Write tests', status: 'in_progress', priority: null },
      { content: 'Ship it', status: 'pending', priority: null },
    ]);
  });

  test('returns null when entries are missing or not an array', () => {
    expect(parsePlanEntries({})).toBeNull();
    expect(parsePlanEntries({ entries: 'nope' })).toBeNull();
  });

  test('skips entries without text content', () => {
    expect(parsePlanEntries({ entries: [{ status: 'pending' }, { content: 'Real task' }] })).toEqual([
      { content: 'Real task', status: 'pending', priority: null },
    ]);
  });
});

describe('isToolCallEvent', () => {
  test('matches only tool_call events', () => {
    expect(
      isToolCallEvent({
        id: '1',
        laneId: 'lane',
        sequence: 1,
        kind: CodingEventKind.ToolCall,
        payload: {},
        createdAt: 1,
      }),
    ).toBe(true);
    expect(
      isToolCallEvent({
        id: '2',
        laneId: 'lane',
        sequence: 2,
        kind: CodingEventKind.Plan,
        payload: {},
        createdAt: 2,
      }),
    ).toBe(false);
  });
});
