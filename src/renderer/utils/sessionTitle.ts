import {
  CoworkSessionSource,
  CoworkScheduledSessionTitlePrefix,
  stripScheduledSessionTitlePrefix,
} from '../../shared/cowork/constants';

/**
 * Show a scheduled session title with the prefix of the current UI language.
 *
 * Titles are stored with the canonical `[定时]` prefix (see
 * `buildScheduledSessionTitle`); older rows still carry the legacy English
 * `Scheduled: ` marker and rows created in the other language carry `[Cron]`.
 * Only the displayed prefix is swapped, so no stored session is rewritten.
 */
export const localizeScheduledSessionTitle = (title: string, language: 'zh' | 'en'): string => {
  const normalizedTitle = title.trim();
  const prefix = Object.values(CoworkScheduledSessionTitlePrefix).find(candidate =>
    normalizedTitle.startsWith(candidate),
  );
  if (!prefix) return title;
  const localized =
    language === 'en'
      ? CoworkScheduledSessionTitlePrefix.English
      : CoworkScheduledSessionTitlePrefix.Chinese;
  if (prefix === localized) return title;
  return `${localized}${stripScheduledSessionTitlePrefix(title)}`;
};

/**
 * The title a session surface should render: scheduled rows show the prefix of
 * the current UI language, every other row shows its stored title.
 */
export const resolveSessionDisplayTitle = (
  session: { title: string; source?: string | null },
  language: 'zh' | 'en',
): string =>
  session.source === CoworkSessionSource.Scheduled
    ? localizeScheduledSessionTitle(session.title, language)
    : session.title;
