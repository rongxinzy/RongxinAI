import { describe, expect, test } from 'vitest';

import {
  sanitizeCoworkMessageForIpc,
  sanitizeCoworkSessionForIpc,
  sanitizeIpcPayload,
  sanitizePermissionRequestForIpc,
  slimCoworkMessageForIpc,
  truncateIpcString,
} from './ipcPayloadSanitize';

describe('truncateIpcString', () => {
  test('returns short strings unchanged', () => {
    expect(truncateIpcString('abc', 10)).toBe('abc');
  });

  test('appends truncation marker past the limit', () => {
    const result = truncateIpcString('a'.repeat(25), 10);
    expect(result.startsWith('a'.repeat(10))).toBe(true);
    expect(result).toContain('...[truncated in main IPC forwarding]');
  });
});

describe('sanitizeIpcPayload', () => {
  test('passes through primitives', () => {
    expect(sanitizeIpcPayload(null)).toBeNull();
    expect(sanitizeIpcPayload(42)).toBe(42);
    expect(sanitizeIpcPayload(true)).toBe(true);
    expect(sanitizeIpcPayload(undefined)).toBeUndefined();
  });

  test('truncates long strings', () => {
    const result = sanitizeIpcPayload('x'.repeat(5000)) as string;
    expect(result.length).toBeLessThan(5000);
    expect(result).toContain('...[truncated in main IPC forwarding]');
  });

  test('stringifies bigint and functions', () => {
    expect(sanitizeIpcPayload(10n)).toBe('10');
    expect(sanitizeIpcPayload(() => 1)).toBe('[function]');
  });

  test('truncates arrays beyond the item cap', () => {
    const result = sanitizeIpcPayload(new Array(50).fill('a')) as string[];
    expect(result).toHaveLength(41);
    expect(result[40]).toBe('[truncated-items:10]');
  });

  test('truncates objects beyond the key cap', () => {
    const value: Record<string, number> = {};
    for (let i = 0; i < 90; i += 1) value[`k${i}`] = i;
    const result = sanitizeIpcPayload(value) as Record<string, unknown>;
    expect(result.__truncated_keys__).toBe(10);
    expect(result.k0).toBe(0);
    expect(result.k89).toBeUndefined();
  });

  test('replaces circular references', () => {
    const value: Record<string, unknown> = { name: 'root' };
    value.self = value;
    const result = sanitizeIpcPayload(value) as Record<string, unknown>;
    expect(result.name).toBe('root');
    expect(result.self).toBe('[circular]');
  });

  test('caps nesting depth', () => {
    const deep = { a: { b: { c: { d: { e: { f: 'leaf' } } } } } };
    const result = sanitizeIpcPayload(deep) as Record<string, unknown>;
    const level5 = (result.a as Record<string, unknown>).b as Record<string, unknown>;
    const level4 = level5.c as Record<string, unknown>;
    const level3 = level4.d as Record<string, unknown>;
    expect(level3.e).toBe('[truncated-depth]');
  });
});

describe('sanitizeCoworkMessageForIpc', () => {
  test('passes non-object messages through', () => {
    expect(sanitizeCoworkMessageForIpc('plain')).toBe('plain');
    expect(sanitizeCoworkMessageForIpc(null)).toBeNull();
  });

  test('truncates string content and preserves other fields', () => {
    const message = {
      id: 'm1',
      role: 'user',
      content: 'y'.repeat(200_000),
    };
    const result = sanitizeCoworkMessageForIpc(message) as Record<string, unknown>;
    expect(result.id).toBe('m1');
    expect((result.content as string).length).toBeLessThan(200_000);
    expect(result.content).toContain('...[truncated in main IPC forwarding]');
  });

  test('normalizes non-string content to empty string', () => {
    const result = sanitizeCoworkMessageForIpc({ content: 123 }) as Record<string, unknown>;
    expect(result.content).toBe('');
  });

  test('keeps slimmed file attachments and drops unknown attachment shapes', () => {
    const message = {
      content: 'hi',
      metadata: {
        fileAttachments: [
          { name: 'a.txt', path: '/tmp/a.txt', extension: '.txt' },
          { name: 42, path: true, extension: null, isImage: 'yes' },
          null,
        ],
      },
    };
    const result = sanitizeCoworkMessageForIpc(message) as {
      metadata: { fileAttachments: Array<Record<string, unknown>> };
    };
    expect(result.metadata.fileAttachments).toHaveLength(2);
    expect(result.metadata.fileAttachments[0]).toEqual({
      name: 'a.txt',
      path: '/tmp/a.txt',
      extension: '.txt',
    });
    expect(result.metadata.fileAttachments[1]).toEqual({
      name: '',
      path: '',
      extension: '',
    });
  });
});

describe('slimCoworkMessageForIpc', () => {
  test('keeps path-based attachments and drops unknown attachment shapes', () => {
    const message = {
      type: 'user',
      content: 'hello',
      metadata: {
        imageAttachments: [
          { name: 'shot.png', mimeType: 'image/png', path: '/tmp/shot.png' },
          { name: 'gone.png', data: 'data:image/png;base64,AAAA' },
        ],
        keep: 'me',
      },
    };
    const result = slimCoworkMessageForIpc(message) as {
      metadata: Record<string, unknown>;
    };
    expect(result.metadata.keep).toBe('me');
    const images = result.metadata.imageAttachments as Array<Record<string, unknown>>;
    expect(images).toHaveLength(1);
    expect(images[0]).toEqual({
      name: 'shot.png',
      mimeType: 'image/png',
      path: '/tmp/shot.png',
    });
  });

  test('keeps toolResult only when content is empty', () => {
    const legacy = slimCoworkMessageForIpc({
      type: 'tool_result',
      content: '',
      metadata: { toolResult: 'big output' },
    }) as { metadata: Record<string, unknown> };
    expect(legacy.metadata.toolResult).toBe('big output');

    const modern = slimCoworkMessageForIpc({
      type: 'tool_result',
      content: 'fresh',
      metadata: { toolResult: 'big output' },
    }) as { metadata: Record<string, unknown> };
    expect(modern.metadata.toolResult).toBeUndefined();
  });

  test('truncates oversized tool_result content', () => {
    const result = slimCoworkMessageForIpc({
      type: 'tool_result',
      content: 'z'.repeat(150_000),
    }) as { content: string };
    expect(result.content.length).toBeLessThan(150_000);
    expect(result.content).toContain('...[truncated in main IPC forwarding]');
  });
});

describe('sanitizeCoworkSessionForIpc', () => {
  test('returns sessions without messages untouched', () => {
    const session = { id: 's1' };
    expect(sanitizeCoworkSessionForIpc(session)).toBe(session);
  });

  test('slims every message', () => {
    const result = sanitizeCoworkSessionForIpc({
      id: 's1',
      messages: [
        { type: 'user', content: 'a', metadata: { toolResult: 'x' } },
        { type: 'user', content: 'b', metadata: { toolResult: 'y' } },
      ],
    });
    expect(result.messages).toHaveLength(2);
    for (const message of result.messages as Array<{ metadata: Record<string, unknown> }>) {
      expect(message.metadata.toolResult).toBeUndefined();
    }
  });
});

describe('sanitizePermissionRequestForIpc', () => {
  test('passes non-object requests through', () => {
    expect(sanitizePermissionRequestForIpc(undefined)).toBeUndefined();
  });

  test('sanitizes toolInput while keeping other fields', () => {
    const request = {
      id: 'p1',
      toolName: 'bash',
      toolInput: { command: 'c'.repeat(6000), nested: { deep: { deeper: { deepest: 1 } } } },
    };
    const result = sanitizePermissionRequestForIpc(request) as {
      id: string;
      toolName: string;
      toolInput: { command: string; nested: Record<string, unknown> };
    };
    expect(result.id).toBe('p1');
    expect(result.toolName).toBe('bash');
    expect(result.toolInput.command.length).toBeLessThan(6000);
  });

  test('defaults missing toolInput to empty object', () => {
    const result = sanitizePermissionRequestForIpc({ id: 'p2' }) as { toolInput: unknown };
    expect(result.toolInput).toEqual({});
  });
});
