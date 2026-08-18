import { describe, expect, test } from 'vitest';

import { isScheduledSessionTitle } from './constants';

describe('isScheduledSessionTitle', () => {
  test('recognizes localized cron session prefixes', () => {
    expect(isScheduledSessionTitle('[定时]计算题')).toBe(true);
    expect(isScheduledSessionTitle('[Cron] daily report')).toBe(true);
  });

  test('recognizes the legacy executor prefix for backfill parity', () => {
    expect(isScheduledSessionTitle('Scheduled: daily report')).toBe(true);
  });

  test('does not classify ordinary sessions by a later title fragment', () => {
    expect(isScheduledSessionTitle('计算题 [定时]')).toBe(false);
    expect(isScheduledSessionTitle('普通会话')).toBe(false);
  });
});
