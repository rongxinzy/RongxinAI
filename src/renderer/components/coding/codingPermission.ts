import {
  CodingEventKind,
  CodingPermissionOutcome,
  type CodingEvent,
} from '../../../shared/codingAgent';

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

export const CodingPermissionOptionDefaultName: Record<string, string> = {
  [CodingPermissionOptionKind.AllowOnce]: 'allow once',
  [CodingPermissionOptionKind.AllowAlways]: 'allow for session',
  [CodingPermissionOptionKind.RejectOnce]: 'reject once',
  [CodingPermissionOptionKind.RejectAlways]: 'always reject',
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

export const isGenericCodingPermissionOption = (option: CodingPermissionOption): boolean => {
  if (!option.kind) return false;
  const defaultName = CodingPermissionOptionDefaultName[option.kind];
  return defaultName ? option.name.trim().toLowerCase() === defaultName : false;
};

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
