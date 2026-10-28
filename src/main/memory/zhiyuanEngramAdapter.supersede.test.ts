import { afterEach, expect, test, vi } from 'vitest';

import { EngramMemoryScope, EngramObservationType } from './constants';
import { ZhiYuanEngramAdapter } from './zhiyuanEngramAdapter';

function stubManager() {
  return {
    getConnection: () => ({ url: 'http://127.0.0.1:4000', token: 'token' }),
    start: vi.fn(),
  } as never;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test('forget passes the trusted owner assertion when provided', async () => {
  const urls: URL[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL) => {
      urls.push(new URL(url));
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  );
  const adapter = new ZhiYuanEngramAdapter(stubManager());

  await adapter.forget(7, true, 'workspace-abc');

  expect(urls[0].pathname).toBe('/observations/7');
  expect(urls[0].searchParams.get('hard')).toBe('true');
  expect(urls[0].searchParams.get('expected_project')).toBe('workspace-abc');
});

test('supersede does not delete when the replacement reuses the original id', async () => {
  const requests: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      requests.push(`${init?.method ?? 'GET'} ${new URL(url).pathname}`);
      return new Response(JSON.stringify({ id: 5 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
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

  await expect(
    adapter.supersede({
      observationId: 5,
      replacementCandidateId: candidate.id,
      workingDirectory: '/workspace/project-a',
    }),
  ).resolves.toBe(5);
  expect(requests.some(entry => entry.startsWith('DELETE'))).toBe(false);
});

test('supersede passes the replacement project as the owner assertion on delete', async () => {
  const deletes: URL[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (init?.method === 'DELETE') deletes.push(new URL(url));
      return new Response(JSON.stringify({ id: 9 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
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

  await expect(
    adapter.supersede({
      observationId: 5,
      replacementCandidateId: candidate.id,
      workingDirectory: '/workspace/project-a',
    }),
  ).resolves.toBe(9);
  expect(deletes).toHaveLength(1);
  expect(deletes[0].pathname).toBe('/observations/5');
  expect(deletes[0].searchParams.get('expected_project')).toBe('project-a');
});
