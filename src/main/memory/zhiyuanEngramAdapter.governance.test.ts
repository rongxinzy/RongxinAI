import { afterEach, expect, test, vi } from 'vitest';

import { EngramMemoryScope, EngramObservationType } from './constants';
import { ZhiYuanEngramAdapter } from './zhiyuanEngramAdapter';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubManager() {
  return {
    getConnection: () => ({ url: 'http://127.0.0.1:4000', token: 'token' }),
    start: vi.fn(),
  } as never;
}

test('confirmMemory recovers a committed result via save-result after a timeout', async () => {
  const calls: Array<{ pathname: string; method: string; operationId?: string }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const parsed = new URL(url);
      const method = init?.method ?? 'GET';
      if (parsed.pathname === '/observations' && method === 'POST') {
        const body = JSON.parse(String(init?.body));
        calls.push({ pathname: parsed.pathname, method, operationId: body.operation_id });
        throw Object.assign(new Error('The operation was aborted due to timeout'), {
          name: 'AbortError',
        });
      }
      if (parsed.pathname === '/observations/save-result') {
        calls.push({ pathname: parsed.pathname, method });
        return new Response(JSON.stringify({ id: 17, status: 'committed' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  );
  const adapter = new ZhiYuanEngramAdapter(stubManager());
  const candidate = adapter.saveCandidate({
    sessionId: 'session-1',
    project: 'project-a',
    scope: EngramMemoryScope.Project,
    type: EngramObservationType.Decision,
    title: 'title',
    content: 'content',
  });

  await expect(adapter.confirmMemory(candidate.id, '/workspace/project-a')).resolves.toBe(17);
  expect(calls.some(call => call.pathname === '/observations/save-result')).toBe(true);
  expect(calls.find(call => call.pathname === '/observations')?.operationId).toBe(candidate.id);
});

test('confirmMemory does not recover on non-timeout errors', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{"error":"bad request"}', { status: 400 })),
  );
  const adapter = new ZhiYuanEngramAdapter(stubManager());
  const candidate = adapter.saveCandidate({
    sessionId: 'session-1',
    project: 'project-a',
    scope: EngramMemoryScope.Project,
    type: EngramObservationType.Decision,
    title: 'title',
    content: 'content',
  });

  await expect(adapter.confirmMemory(candidate.id, '/workspace/project-a')).rejects.toThrow(
    'HTTP 400',
  );
});

test('finalizeSession posts the caller-authored summary once per close', async () => {
  const requests: Array<{ pathname: string; body: unknown }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const parsed = new URL(url);
      requests.push({ pathname: parsed.pathname, body: JSON.parse(String(init?.body)) });
      return new Response(
        JSON.stringify({
          session_id: 'session-1',
          state: 'finalized',
          summary_id: 'sum-1',
          already_finalized: true,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }),
  );
  const adapter = new ZhiYuanEngramAdapter(stubManager());
  const result = await adapter.finalizeSession('session-1', '## Goal\nShip it');
  expect(requests[0].pathname).toBe('/sessions/session-1/finalize');
  expect(requests[0].body).toEqual({ summary: '## Goal\nShip it' });
  expect(result.alreadyFinalized).toBe(true);
});

test('scanConflicts never opts into the external semantic runner by default', async () => {
  let body: Record<string, unknown> | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  );
  const adapter = new ZhiYuanEngramAdapter(stubManager());
  await adapter.scanConflicts({ project: 'project-a' });
  expect(body).toEqual({ project: 'project-a' });
  expect(body?.semantic).toBeUndefined();
});
