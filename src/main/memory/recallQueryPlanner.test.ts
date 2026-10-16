import { expect, test } from 'vitest';

import { planRecallQuery, rankRecallResults } from './recallQueryPlanner';
import type { EngramObservation } from './types';

function observation(input: Partial<EngramObservation> & Pick<EngramObservation, 'id'>) {
  return {
    sync_id: `sync-${input.id}`,
    session_id: 'session-1',
    type: 'decision',
    title: '',
    content: '',
    scope: 'project',
    revision_count: 1,
    duplicate_count: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...input,
  } satisfies EngramObservation;
}

test('segments an unspaced CJK memory question into a broad fallback query', () => {
  const plan = planRecallQuery('我们之前决定当前项目使用什么数据库');

  expect(plan.exactQuery).toBe('我们之前决定当前项目使用什么数据库');
  expect(plan.broadQuery).toContain('项目');
  expect(plan.broadQuery).toContain('数据');
  expect(plan.explicitMemoryIntent).toBe(true);
});

test('does not broaden short non-CJK queries', () => {
  expect(planRecallQuery('database decision')).toMatchObject({
    exactQuery: 'database decision',
    broadQuery: null,
    explicitMemoryIntent: false,
    allowRecentFallback: false,
  });
});

test('extracts keyword broad query for natural-language english recall questions', () => {
  const plan = planRecallQuery(
    'What persistence technology did the team decide to standardize on for this workspace?',
  );

  expect(plan.broadQuery).toContain('persistence');
  expect(plan.broadQuery).toContain('standardize');
  expect(plan.broadQuery).toContain('workspace');
  expect(plan.allowRecentFallback).toBe(true);
});

test('ranks exact title matches ahead of weaker content matches', () => {
  const results = rankRecallResults('知远', [
    observation({ id: 1, title: 'Other', content: '知远 is mentioned here.' }),
    observation({ id: 2, title: '知远', content: 'Project identity.' }),
  ]);

  expect(results.map(result => result.id)).toEqual([2, 1]);
});
