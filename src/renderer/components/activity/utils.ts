import { i18nService } from '../../services/i18n';

/** Simple template: replace `{key}` placeholders with values. */
const tpl = (template: string, vars: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? '');

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

/**
 * Quiet relative timestamp for feed rows: "刚刚" / "N 分钟前" within the
 * hour, otherwise the locale clock time (the day grouping above the row
 * already carries the date).
 */
export const formatActivityTime = (timestampMs: number, nowMs: number = Date.now()): string => {
  const diffMs = nowMs - timestampMs;
  if (diffMs < MINUTE_MS) {
    return i18nService.t('activityTimeJustNow');
  }
  if (diffMs < HOUR_MS) {
    return tpl(i18nService.t('activityTimeMinutesAgo'), {
      n: String(Math.floor(diffMs / MINUTE_MS)),
    });
  }
  const date = new Date(timestampMs);
  const lang = i18nService.getLanguage();
  return date.toLocaleTimeString(lang === 'zh' ? 'zh-CN' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: lang !== 'zh',
  });
};

const DAY_MS = 86_400_000;

const startOfDay = (timestampMs: number): number => {
  const date = new Date(timestampMs);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

/** Day-group label for the feed: 今天 / 昨天 / locale date. */
export const formatActivityDayLabel = (timestampMs: number, nowMs: number = Date.now()): string => {
  const todayStart = startOfDay(nowMs);
  const dayStart = startOfDay(timestampMs);
  if (dayStart === todayStart) {
    return i18nService.t('activityGroupToday');
  }
  if (dayStart === todayStart - DAY_MS) {
    return i18nService.t('activityGroupYesterday');
  }
  const lang = i18nService.getLanguage();
  return new Date(timestampMs).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', {
    month: 'long',
    day: 'numeric',
  });
};
