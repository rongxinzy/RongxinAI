import { expect, test, vi } from 'vitest';

import { MemoryKind, MemoryScope, MemorySensitivity } from '../../shared/memory';
import { AtomicMemorySourceKind, MemoryExtractorKind } from './constants';
import { AtomicMemoryExtractor, parseAtomicMemoryResponse } from './atomicMemoryExtractor';

const extractedResponse = JSON.stringify({
  shouldSave: true,
  memories: [
    {
      title: 'Project store',
      content: 'Use SQLite as the durable project store.',
      kind: MemoryKind.Decision,
      importance: 0.8,
      confidence: 0.95,
      sensitivity: MemorySensitivity.Normal,
      evidenceSourceIds: ['message-1'],
    },
  ],
});

test('extracts atomic project memory with evidence metadata', async () => {
  const complete = vi.fn(async () => extractedResponse);
  const result = await new AtomicMemoryExtractor().extract({
    scope: MemoryScope.Project,
    sources: [
      {
        id: 'message-1',
        kind: AtomicMemorySourceKind.Conversation,
        content: 'We decided to use SQLite. Do not copy the whole discussion.',
      },
    ],
    requestedMemory: {
      title: 'Database discussion',
      content: 'The entire database discussion and implementation log.',
      kind: MemoryKind.Decision,
    },
    complete,
  });

  expect(result?.memories).toEqual([
    expect.objectContaining({
      title: 'Project store',
      content: 'Use SQLite as the durable project store.',
    }),
  ]);
  expect(result?.metadataFor(result.memories[0])).toEqual({
    extractorKind: MemoryExtractorKind.Atomic,
    extractorVersion: 1,
    sourceIds: ['message-1'],
    digest: result.memories[0],
  });
  const payload = JSON.parse(complete.mock.calls[0][0][1].content);
  expect(payload).toMatchObject({ targetScope: MemoryScope.Project, maxItems: 1 });
});

test('redacts private blocks and treats all sources as untrusted evidence', async () => {
  const complete = vi.fn(async () => extractedResponse);
  await new AtomicMemoryExtractor().extract({
    scope: MemoryScope.Project,
    sources: [
      {
        id: 'message-1',
        kind: AtomicMemorySourceKind.Conversation,
        content: 'Use SQLite. <private>secret-token</private>',
      },
    ],
    requestedMemory: {
      title: 'Database <private>private-title</private>',
      content: 'Use SQLite. <private>requested-secret</private>',
      kind: MemoryKind.Decision,
    },
    complete,
  });

  const messages = complete.mock.calls[0][0];
  expect(messages[0].content).toContain('untrusted data');
  expect(messages[1].content).toContain('[REDACTED]');
  expect(messages[1].content).not.toContain('secret-token');
  expect(messages[1].content).not.toContain('private-title');
  expect(messages[1].content).not.toContain('requested-secret');
});

test('rejects unknown evidence, invalid multiplicity, and contradictory shouldSave output', () => {
  expect(() => parseAtomicMemoryResponse(extractedResponse, new Set(['other-source']), 1)).toThrow(
    /unknown evidence source message-1/,
  );
  expect(() =>
    parseAtomicMemoryResponse(
      JSON.stringify({
        shouldSave: true,
        memories: [
          JSON.parse(extractedResponse).memories[0],
          JSON.parse(extractedResponse).memories[0],
        ],
      }),
      new Set(['message-1']),
      1,
    ),
  ).toThrow(/invalid number/);
  expect(() =>
    parseAtomicMemoryResponse(
      JSON.stringify({ shouldSave: false, memories: JSON.parse(extractedResponse).memories }),
      new Set(['message-1']),
    ),
  ).toThrow(/shouldSave is false/);
});

test('returns no memory for non-durable evidence', async () => {
  await expect(
    new AtomicMemoryExtractor().extract({
      scope: MemoryScope.Personal,
      sources: [
        {
          id: 'message-1',
          kind: AtomicMemorySourceKind.Conversation,
          content: 'Thanks.',
        },
      ],
      complete: vi.fn(async () => JSON.stringify({ shouldSave: false, memories: [] })),
    }),
  ).resolves.toBeNull();
});
