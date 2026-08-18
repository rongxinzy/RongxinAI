import { expect, test, vi } from 'vitest';

import type { CoworkMessage } from '../coworkStore';
import { SessionSummaryService } from './sessionSummaryService';

function message(type: CoworkMessage['type'], content: string): CoworkMessage {
  return { id: `${type}-${content}`, type, content, timestamp: 1 };
}

test('saves a semantic extraction with its provenance metadata', async () => {
  const saveSessionSummary = vi.fn(async () => 21);
  const memoryService = {
    getActiveSessionSummary: vi.fn(() => ({
      content: 'Semantic session memory (v1)',
      metadata: {
        extractorVersion: 1,
        sourceMessageIds: ['prior-user'],
        digest: { shouldSave: true, goal: { text: 'Prior goal' } },
      },
    })),
    saveSessionSummary,
  };
  const coworkStore = {
    getSession: vi.fn(() => ({
      messages: [message('user', '修复召回'), message('assistant', '已经完成索引修复。')],
    })),
  };
  const extractor = {
    extract: vi.fn(async () => ({
      summary: 'Semantic session memory (v1)\nGoal: 修复召回\nCurrent state: 已完成索引修复',
      metadata: {
        extractorVersion: 1,
        sourceMessageIds: ['user-修复召回', 'assistant-已经完成索引修复。'],
        digest: { shouldSave: true },
      },
    })),
  };
  const service = new SessionSummaryService(
    memoryService as never,
    coworkStore as never,
    extractor as never,
  );
  const complete = vi.fn();

  await expect(
    service.rollup({ sessionId: 'session-1', workingDirectory: '/workspace', complete }),
  ).resolves.toBe(21);

  expect(extractor.extract).toHaveBeenCalledWith(
    expect.objectContaining({
      previousMemory: {
        digest: { shouldSave: true, goal: { text: 'Prior goal' } },
        sourceMessageIds: ['prior-user'],
      },
      complete,
    }),
  );
  expect(saveSessionSummary).toHaveBeenCalledWith(
    expect.objectContaining({
      sessionId: 'session-1',
      workingDirectory: '/workspace',
      metadata: expect.objectContaining({ extractorVersion: 1 }),
    }),
  );
});

test('serializes extraction and writes for the same session', async () => {
  let releaseFirst: (() => void) | undefined;
  type ExtractedMemory = { summary: string; metadata: Record<string, unknown> };
  const extract = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<ExtractedMemory>(resolve => {
          releaseFirst = () => resolve({ summary: 'first', metadata: {} });
        }),
    )
    .mockResolvedValueOnce({ summary: 'second', metadata: {} });
  const saveSessionSummary = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);
  const memoryService = {
    getActiveSessionSummary: vi.fn(() => null),
    saveSessionSummary,
  };
  const coworkStore = {
    getSession: vi.fn(() => ({
      messages: [message('user', '目标'), message('assistant', '结果')],
    })),
  };
  const service = new SessionSummaryService(
    memoryService as never,
    coworkStore as never,
    { extract } as never,
  );
  const complete = vi.fn();

  const first = service.rollup({
    sessionId: 'session-1',
    workingDirectory: '/workspace',
    complete,
  });
  const second = service.rollup({
    sessionId: 'session-1',
    workingDirectory: '/workspace',
    complete,
  });
  await vi.waitFor(() => expect(extract).toHaveBeenCalledTimes(1));
  releaseFirst?.();

  await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
  expect(extract).toHaveBeenCalledTimes(2);
  expect(saveSessionSummary).toHaveBeenCalledTimes(2);
});

test('does not overwrite memory when extraction has no reusable state', async () => {
  const saveSessionSummary = vi.fn();
  const service = new SessionSummaryService(
    {
      getActiveSessionSummary: vi.fn(() => ({
        content: 'Existing semantic memory',
        metadata: {},
      })),
      saveSessionSummary,
    } as never,
    {
      getSession: vi.fn(() => ({
        messages: [message('user', '你好'), message('assistant', '你好！')],
      })),
    } as never,
    { extract: vi.fn(async () => null) } as never,
  );

  await expect(
    service.rollup({
      sessionId: 'session-1',
      workingDirectory: '/workspace',
      complete: vi.fn(),
    }),
  ).resolves.toBeNull();
  expect(saveSessionSummary).not.toHaveBeenCalled();
});

test('does not carry an unversioned legacy summary into semantic extraction', async () => {
  const extract = vi.fn(async () => null);
  const service = new SessionSummaryService(
    {
      getActiveSessionSummary: vi.fn(() => ({
        content: 'Session objective: copied legacy transcript',
        metadata: {},
      })),
      saveSessionSummary: vi.fn(),
    } as never,
    {
      getSession: vi.fn(() => ({
        messages: [message('user', '继续修复'), message('assistant', '已完成新一轮验证。')],
      })),
    } as never,
    { extract } as never,
  );

  await service.rollup({
    sessionId: 'session-1',
    workingDirectory: '/workspace',
    complete: vi.fn(),
  });

  expect(extract).toHaveBeenCalledWith(expect.objectContaining({ previousMemory: undefined }));
});
