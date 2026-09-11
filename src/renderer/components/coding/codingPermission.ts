import {
  CodingEventKind,
  CodingPermissionOutcome,
  type CodingEvent,
} from '../../../shared/codingAgent';
import { i18nService } from '../../services/i18n';

export interface CodingPermissionOption {
  optionId: string;
  name: string;
  kind: string | null;
  description?: string;
}

export const CodingPermissionOptionKind = {
  AllowOnce: 'allow_once',
  AllowAlways: 'allow_always',
  RejectOnce: 'reject_once',
  RejectAlways: 'reject_always',
} as const;

/**
 * Names agents use for the generic options of each kind. Anything outside these
 * lists is a custom scope (for example a command-prefix grant) and keeps the
 * agent-provided wording instead of the localized label.
 */
const CodingPermissionOptionGenericNames: Record<string, string[]> = {
  [CodingPermissionOptionKind.AllowOnce]: [
    'allow',
    'allow once',
    'allow this time',
    'approve',
    'approve once',
    'yes',
  ],
  [CodingPermissionOptionKind.AllowAlways]: [
    'allow all',
    'allow always',
    'allow always for this session',
    'allow for session',
    'allow for this session',
    'always',
    'always allow',
    'yes to all',
  ],
  [CodingPermissionOptionKind.RejectOnce]: ['deny', 'deny once', 'no', 'reject', 'reject once'],
  [CodingPermissionOptionKind.RejectAlways]: [
    'always deny',
    'always reject',
    'deny always',
    'never allow',
    'reject always',
  ],
};

const normalizeCodingPermissionOptionName = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/[\s.。!！]+$/u, '')
    .replace(/\s+/gu, ' ');

/**
 * Kind that decides the localized label. A known kind wins over the name; an
 * option without one is matched against every generic name list so agents that
 * omit `kind` still render localized buttons.
 */
const genericCodingPermissionOptionKind = (option: CodingPermissionOption): string | null => {
  const name = normalizeCodingPermissionOptionName(option.name);
  const candidateKinds =
    option.kind && CodingPermissionOptionGenericNames[option.kind]
      ? [option.kind]
      : Object.keys(CodingPermissionOptionGenericNames);
  return (
    candidateKinds.find(kind => CodingPermissionOptionGenericNames[kind]?.includes(name)) ?? null
  );
};

const CodingPermissionOptionI18nKey: Record<string, string> = {
  [CodingPermissionOptionKind.AllowOnce]: 'codingAgentPermissionAllowOnce',
  [CodingPermissionOptionKind.AllowAlways]: 'codingAgentPermissionAllowAlways',
  [CodingPermissionOptionKind.RejectOnce]: 'codingAgentPermissionRejectOnce',
  [CodingPermissionOptionKind.RejectAlways]: 'codingAgentPermissionRejectAlways',
};

export interface CodingPermissionPresentation {
  toolName: string | null;
  toolKind: string | null;
  toolInput: Record<string, unknown> | null;
  options: CodingPermissionOption[];
}

export const CodingPermissionResolution = {
  Pending: 'pending',
  Approved: 'approved',
  Rejected: 'rejected',
  Responded: 'responded',
} as const;
export type CodingPermissionResolution =
  (typeof CodingPermissionResolution)[keyof typeof CodingPermissionResolution];

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const readString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const parseOptions = (value: unknown): CodingPermissionOption[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap(option => {
    const record = asRecord(option);
    const optionId = readString(record?.optionId);
    const name = readString(record?.name);
    if (!optionId || !name) return [];
    const kind = readString(record?.kind);
    const description = readString(record?.description);
    return [{ optionId, name, kind, ...(description ? { description } : {}) }];
  });
};

export const parseCodingPermission = (event: CodingEvent): CodingPermissionPresentation => {
  const request = asRecord(event.payload.request);
  const toolCall = asRecord(event.payload.toolCall);
  const toolInput =
    asRecord(event.payload.toolInput) ??
    asRecord(request?.toolInput) ??
    asRecord(toolCall?.input) ??
    asRecord(toolCall?.rawInput) ??
    null;
  const options = parseOptions(event.payload.options ?? request?.options);
  const toolName =
    readString(event.payload.toolName) ??
    readString(request?.toolName) ??
    readString(toolCall?.name) ??
    readString(toolCall?.title);
  const toolKind =
    readString(event.payload.toolKind) ??
    readString(request?.toolKind) ??
    readString(toolCall?.kind);

  return { toolName, toolKind, toolInput, options };
};

export const getCodingPermissionResolution = (
  event: CodingEvent,
): CodingPermissionResolution => {
  const outcome = event.payload.permissionOutcome;
  if (outcome === CodingPermissionOutcome.Cancelled) {
    return CodingPermissionResolution.Rejected;
  }
  if (outcome !== CodingPermissionOutcome.Selected) {
    return CodingPermissionResolution.Pending;
  }

  const optionId = readString(event.payload.optionId);
  if (!optionId) return CodingPermissionResolution.Approved;
  const selectedOption = parseCodingPermission(event).options.find(
    option => option.optionId === optionId,
  );
  if (!selectedOption) return CodingPermissionResolution.Responded;
  if (
    selectedOption.kind === CodingPermissionOptionKind.RejectOnce ||
    selectedOption.kind === CodingPermissionOptionKind.RejectAlways
  ) {
    return CodingPermissionResolution.Rejected;
  }
  if (
    selectedOption.kind === CodingPermissionOptionKind.AllowOnce ||
    selectedOption.kind === CodingPermissionOptionKind.AllowAlways
  ) {
    return CodingPermissionResolution.Approved;
  }
  return CodingPermissionResolution.Responded;
};

export const formatCodingPermissionInput = (input: Record<string, unknown> | null): string => {
  if (!input) return '';
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
};

export const findPendingCodingPermission = (events: CodingEvent[]): CodingEvent | null => {
  const resolvedRequestIds = new Set<string>();
  for (const event of events.slice().reverse()) {
    if (event.kind === CodingEventKind.ToolCall) {
      const requestId = event.payload.permissionRequestId;
      if (typeof requestId === 'string' && requestId) resolvedRequestIds.add(requestId);
      continue;
    }
    if (event.kind !== CodingEventKind.Permission) continue;
    const requestId = event.payload.requestId;
    if (typeof requestId === 'string' && requestId && !resolvedRequestIds.has(requestId)) {
      return event;
    }
  }
  return null;
};

const isRejectOption = (option: CodingPermissionOption): boolean => {
  const kind = option.kind ?? genericCodingPermissionOptionKind(option);
  return (
    kind === CodingPermissionOptionKind.RejectOnce ||
    kind === CodingPermissionOptionKind.RejectAlways
  );
};

/** Long-term grants stay above one-off and destructive scopes in the menu. */
const overflowRank = (option: CodingPermissionOption): number => {
  const kind = option.kind ?? genericCodingPermissionOptionKind(option);
  if (kind === CodingPermissionOptionKind.AllowAlways) return 0;
  if (isRejectOption(option)) return 2;
  return 1;
};

export interface CodingPermissionAction {
  outcome: CodingPermissionOutcome;
  /**
   * ACP option backing this action. Set whenever the agent offered options —
   * only the option-less built-in path may select without an option id,
   * because ACP rejects a selection that carries none.
   */
  optionId?: string;
  /** Option rendered as the button label, or null for the built-in fallback. */
  option: CodingPermissionOption | null;
}

export interface CodingPermissionActions {
  /** Confirm action; null when the agent offered rejection options only. */
  primary: CodingPermissionAction | null;
  /** Dismiss action; falls back to cancelling the request. */
  secondary: CodingPermissionAction;
  /** Remaining options, exposed through the overflow menu. */
  more: CodingPermissionOption[];
}

/**
 * Splits the options an agent offered into a primary action, a secondary
 * action and the overflow menu. Custom scopes (for example a command-prefix
 * grant) keep their agent-provided names and land in the overflow menu.
 */
export const resolveCodingPermissionActions = (
  options: CodingPermissionOption[],
): CodingPermissionActions => {
  if (options.length === 0) {
    return {
      primary: { outcome: CodingPermissionOutcome.Selected, option: null },
      secondary: { outcome: CodingPermissionOutcome.Cancelled, option: null },
      more: [],
    };
  }

  const remaining = [...options];
  const take = (predicate: (option: CodingPermissionOption) => boolean) => {
    const index = remaining.findIndex(predicate);
    if (index < 0) return null;
    const [option] = remaining.splice(index, 1);
    return option ?? null;
  };

  const primaryOption =
    take(option => option.kind === CodingPermissionOptionKind.AllowOnce) ??
    take(option => option.kind === CodingPermissionOptionKind.AllowAlways) ??
    take(option => !isRejectOption(option));
  const secondaryOption =
    take(option => option.kind === CodingPermissionOptionKind.RejectOnce) ??
    take(option => option.kind === CodingPermissionOptionKind.RejectAlways) ??
    take(isRejectOption);

  return {
    primary: primaryOption
      ? {
          outcome: CodingPermissionOutcome.Selected,
          optionId: primaryOption.optionId,
          option: primaryOption,
        }
      : null,
    secondary: secondaryOption
      ? {
          outcome: CodingPermissionOutcome.Selected,
          optionId: secondaryOption.optionId,
          option: secondaryOption,
        }
      : { outcome: CodingPermissionOutcome.Cancelled, option: null },
    more: remaining.toSorted((left, right) => overflowRank(left) - overflowRank(right)),
  };
};

/** Localized label for generic options; custom scopes keep the agent wording. */
export const codingPermissionOptionLabel = (option: CodingPermissionOption): string => {
  const kind = genericCodingPermissionOptionKind(option);
  const i18nKey = kind ? CodingPermissionOptionI18nKey[kind] : undefined;
  return i18nKey ? i18nService.t(i18nKey) : option.name;
};
