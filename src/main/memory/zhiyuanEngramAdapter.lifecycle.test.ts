import { afterEach, expect, test, vi } from 'vitest';

import { EngramMemoryScope, EngramObservationType } from './constants';
import { ZhiYuanEngramAdapter } from './zhiyuanEngramAdapter';

afterEach(() => vi.unstubAllGlobals());

test('continuation identity is used for observations and repeated finalize without re-resume', async () => {
  const requests: Array<{ pathname: string; body?: Record<string, unknown> }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const pathname = new URL(url).pathname;
      const body = init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : undefined;
      requests.push({ pathname, body });
      if (pathname === '/sessions') {
        return jsonResponse({ id: 'session-1:resume:2', resumed_from: 'session-1' }, 201);
      }
      if (pathname === '/observations') return jsonResponse({ id: 42 }, 201);
      return jsonResponse({
        session_id: 'session-1:resume:2',
        state: 'finalized',
        summary_id: 17,
        already_finalized: false,
      });
    }),
  );
  const adapter = new ZhiYuanEngramAdapter({
    getConnection: () => ({ url: 'http://127.0.0.1:4000', token: 'token' }),
    start: vi.fn(),
  } as never);
  const effective = await adapter.resumeSession('session-1', 'project-a', '/work');
  const candidate = adapter.saveCandidate({
    sessionId: 'session-1',
    project: 'project-a',
    scope: EngramMemoryScope.Session,
    type: EngramObservationType.SessionSummary,
    title: 'Session summary',
    content: 'checkpoint',
    operationId: 'checkpoint-1',
  });

  await expect(adapter.confirmMemory(candidate, '/work')).resolves.toBe(42);
  await adapter.finalizeSession({ sessionId: effective, project: 'project-a', summary: 'summary' });
  await adapter.finalizeSession({ sessionId: effective, project: 'project-a', summary: 'summary' });

  expect(effective).toBe('session-1:resume:2');
  expect(requests[0].body).toMatchObject({ id: 'session-1', resume: true });
  expect(requests[1].body).toMatchObject({ session_id: 'session-1:resume:2' });
  expect(requests.filter(request => request.pathname === '/sessions')).toHaveLength(1);
  expect(requests[2].body).toEqual({ project: 'project-a', summary: 'summary' });
  expect(requests[3].pathname).toBe('/sessions/session-1%3Aresume%3A2/finalize');
});

test('an unknown outbox result is recovered before any session resume or rewrite', async () => {
  const requests: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const parsed = new URL(url);
      requests.push(`${init?.method ?? 'GET'} ${parsed.pathname}`);
      return jsonResponse({ id: 42, status: 'committed' });
    }),
  );
  const adapter = new ZhiYuanEngramAdapter({
    getConnection: () => ({ url: 'http://127.0.0.1:4000', token: 'token' }),
    start: vi.fn(),
  } as never);
  const candidate = adapter.saveCandidate({
    sessionId: 'session-1',
    project: 'project-a',
    scope: EngramMemoryScope.Session,
    type: EngramObservationType.SessionSummary,
    title: 'Session summary',
    content: 'checkpoint',
    operationId: 'checkpoint-stable',
    recoverExistingResult: true,
  });

  await expect(adapter.confirmMemory(candidate, '/work')).resolves.toBe(42);
  expect(requests).toEqual(['GET /observations/save-result']);
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
