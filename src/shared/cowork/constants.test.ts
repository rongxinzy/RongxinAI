import { describe, expect, test } from 'vitest';

import {
  buildScheduledSessionTitle,
  normalizeRenamedSessionTitle,
  stripScheduledSessionTitlePrefix,
} from './constants';

describe('buildScheduledSessionTitle', () => {
  test('always stores the canonical prefix', () => {
    expect(buildScheduledSessionTitle('财经新闻')).toBe('[定时]财经新闻');
    expect(buildScheduledSessionTitle('Daily report')).toBe('[定时]Daily report');
  });
});

describe('stripScheduledSessionTitlePrefix', () => {
  test('removes any known prefix and the spacing after it', () => {
    expect(stripScheduledSessionTitlePrefix('Scheduled: 财经新闻')).toBe('财经新闻');
    expect(stripScheduledSessionTitlePrefix('[Cron] daily report')).toBe('daily report');
    expect(stripScheduledSessionTitlePrefix('  [定时]财经新闻  ')).toBe('财经新闻');
  });

  test('leaves titles without a known prefix untouched', () => {
    expect(stripScheduledSessionTitlePrefix('普通会话')).toBe('普通会话');
    expect(stripScheduledSessionTitlePrefix('财经新闻 [定时]')).toBe('财经新闻 [定时]');
  });
});

describe('normalizeRenamedSessionTitle', () => {
  test('keeps the canonical prefix for scheduled sessions', () => {
    expect(normalizeRenamedSessionTitle('[定时]新名字', true)).toBe('[定时]新名字');
    expect(normalizeRenamedSessionTitle('[Cron] new name', true)).toBe('[定时]new name');
    expect(normalizeRenamedSessionTitle('新名字', true)).toBe('[定时]新名字');
  });

  test('does not touch ordinary sessions', () => {
    expect(normalizeRenamedSessionTitle('普通会话', false)).toBe('普通会话');
    expect(normalizeRenamedSessionTitle('[定时]看起来像但其实是普通会话', false)).toBe(
      '[定时]看起来像但其实是普通会话',
    );
  });
});
