import { describe, expect, test } from 'vitest';

import { CoworkSessionSource } from '../../shared/cowork/constants';
import { localizeScheduledSessionTitle, resolveSessionDisplayTitle } from './sessionTitle';

describe('localizeScheduledSessionTitle', () => {
  test('rewrites legacy and foreign prefixes to the current UI language', () => {
    expect(localizeScheduledSessionTitle('Scheduled: daily report', 'zh')).toBe('[定时]daily report');
    expect(localizeScheduledSessionTitle('Scheduled: daily report', 'en')).toBe('[Cron]daily report');
    expect(localizeScheduledSessionTitle('[Cron] daily report', 'zh')).toBe('[定时]daily report');
    expect(localizeScheduledSessionTitle('[定时]计算题', 'en')).toBe('[Cron]计算题');
  });

  test('leaves matching and unprefixed titles untouched', () => {
    expect(localizeScheduledSessionTitle('[定时]计算题', 'zh')).toBe('[定时]计算题');
    expect(localizeScheduledSessionTitle('普通会话', 'zh')).toBe('普通会话');
  });
});

describe('resolveSessionDisplayTitle', () => {
  test('localizes scheduled sessions only', () => {
    expect(resolveSessionDisplayTitle({ title: '[定时]日报', source: 'scheduled' }, 'en')).toBe(
      '[Cron]日报',
    );
    expect(
      resolveSessionDisplayTitle({ title: '[定时]用户自己起的名字', source: 'manual' }, 'en'),
    ).toBe('[定时]用户自己起的名字');
    expect(resolveSessionDisplayTitle({ title: '普通会话' }, 'zh')).toBe('普通会话');
  });

  test('keeps IM sessions untouched', () => {
    expect(resolveSessionDisplayTitle({ title: 'QQ会话', source: CoworkSessionSource.Im }, 'zh')).toBe(
      'QQ会话',
    );
  });
});
