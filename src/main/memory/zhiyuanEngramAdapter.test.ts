import { afterEach, expect, test, vi } from 'vitest';

import { EngramMemoryScope, EngramObservationType } from './constants';
import { redactPrivateBlocks, ZhiYuanEngramAdapter } from './zhiyuanEngramAdapter';

afterEach(() => {
  vi.unstubAllGlobals();
});

test('keeps candidates local until they are explicitly confirmed', async () => {
  const manager = {
    getConnection: () => ({ url: 'http://127.0.0.1:4000', token: 'token' }),
    start: vi.fn(),
  };
  const requests: Array<{ pathname: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      requests.push({ pathname: new URL(url).pathname, init });
      const payload = new URL(url).pathname === '/observations' ? { id: 17 } : { id: 'session' };
      return new Response(JSON.stringify(payload), {
        status: new URL(url).pathname === '/observations' ? 201 : 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  const adapter = new ZhiYuanEngramAdapter(manager as never);

  const candidate = adapter.saveCandidate({
    sessionId: 'session-1',
    project: 'project-a',
    scope: EngramMemoryScope.Project,
    type: EngramObservationType.Decision,
    title: 'Use SQLite',
    content: 'Keep local state in SQLite.',
  });
  expect(requests).toHaveLength(0);

  await expect(adapter.confirmMemory(candidate.id, '/workspace/project-a')).resolves.toBe(17);
  expect(requests.map(request => request.pathname)).toEqual(['/sessions', '/observations']);
  expect(requests[1].init?.headers).toMatchObject({ Authorization: 'Bearer token' });
});

test('includes the failed request method and path in runtime errors', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{"error":"not found"}', { status: 404 })),
  );
  const adapter = new ZhiYuanEngramAdapter({
    getConnection: () => ({ url: 'http://127.0.0.1:4000', token: 'token' }),
    start: vi.fn(),
  } as never);
  const candidate = adapter.saveCandidate({
    sessionId: 'session-1',
    project: 'project-a',
    scope: EngramMemoryScope.Project,
    type: EngramObservationType.Decision,
    title: 'Use SQLite',
    content: 'Keep local state in SQLite.',
  });

  await expect(adapter.confirmMemory(candidate.id, '/workspace/project-a')).rejects.toThrow(
    'Memory service request failed with HTTP 404 for POST /sessions.',
  );
});

test('recall degrades to an empty result when the runtime is unavailable', async () => {
  const adapter = new ZhiYuanEngramAdapter({
    getConnection: () => null,
    start: async () => null,
  } as never);

  await expect(adapter.recall({ query: 'decision', project: 'project-a' })).resolves.toEqual([]);
});

test('normalizes the runtime null search response after the last memory is forgotten', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response('null', { status: 200, headers: { 'content-type': 'application/json' } }),
    ),
  );
  const adapter = new ZhiYuanEngramAdapter({
    getConnection: () => ({ url: 'http://127.0.0.1:4000', token: 'token' }),
    start: vi.fn(),
  } as never);

  await expect(adapter.recall({ query: 'decision', project: 'project-a' })).resolves.toEqual([]);
});

test('forwards the requested match mode and supports bounded recent observations', async () => {
  const urls: URL[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL) => {
      urls.push(new URL(url));
      return new Response('[]', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  const adapter = new ZhiYuanEngramAdapter({
    getConnection: () => ({ url: 'http://127.0.0.1:4000', token: 'token' }),
    start: vi.fn(),
  } as never);

  await adapter.recall({
    query: '项目 数据库',
    project: 'project-a',
    matchMode: 'any',
  });
  await adapter.recent({ project: 'project-a', scope: EngramMemoryScope.Project, limit: 99 });

  expect(urls[0].searchParams.get('match_mode')).toBe('any');
  expect(urls[1].pathname).toBe('/observations/recent');
  expect(urls[1].searchParams.get('limit')).toBe('20');
});

test('redacts explicit private blocks before a candidate can be persisted', () => {
  expect(redactPrivateBlocks('keep <private>secret-token</private> this')).toBe(
    'keep [REDACTED] this',
  );
});
