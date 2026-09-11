import { i18nService } from '../../services/i18n';

/** ACP tool kinds; the matching icons live in `CodingActivityView`. */
const CodingToolKindI18nKey: Record<string, string> = {
  read: 'codingAgentToolKindRead',
  edit: 'codingAgentToolKindEdit',
  delete: 'codingAgentToolKindDelete',
  move: 'codingAgentToolKindMove',
  search: 'codingAgentToolKindSearch',
  execute: 'codingAgentToolKindExecute',
  think: 'codingAgentToolKindThink',
  fetch: 'codingAgentToolKindFetch',
  switch_mode: 'codingAgentToolKindSwitchMode',
  other: 'codingAgentToolKindOther',
};

export const codingToolKindLabel = (kind: string | null): string | null =>
  kind ? i18nService.t(CodingToolKindI18nKey[kind] ?? 'codingAgentToolKindOther') : null;
