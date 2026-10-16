import { MemorySensitivity } from '../../shared/memory';
import { EngramObservationType } from './constants';
import { redactPrivateBlocks } from './zhiyuanEngramAdapter';

export const EXPLICIT_MEMORY_DEFAULT_IMPORTANCE = 0.5;
export const EXPLICIT_MEMORY_DEFAULT_CONFIDENCE = 0.5;
export const EXPLICIT_MEMORY_SOURCE = 'explicit_user_request' as const;

const MAX_EXPLICIT_TITLE_CHARACTERS = 120;
const MAX_EXPLICIT_CONTENT_CHARACTERS = 3_000;

const DISALLOWED_SENSITIVE_CONTENT_PATTERN =
  /\b(?:sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/i;

export type PreparedExplicitUserMemory = {
  title: string;
  content: string;
  kind: typeof EngramObservationType.Decision | typeof EngramObservationType.Preference;
  importance: number;
  confidence: number;
  sensitivity: typeof MemorySensitivity.Normal | typeof MemorySensitivity.Sensitive;
  metadata: { source: typeof EXPLICIT_MEMORY_SOURCE };
};

export type PrepareExplicitUserRequestedMemoryResult =
  | { ok: true; memory: PreparedExplicitUserMemory }
  | { ok: false; message: string; reason: string; isError: true };

export function prepareExplicitUserRequestedMemory(input: {
  title: string;
  content: string;
  kind: typeof EngramObservationType.Decision | typeof EngramObservationType.Preference;
}): PrepareExplicitUserRequestedMemoryResult {
  const rawTitle = input.title.trim();
  const rawContent = input.content.trim();
  if (!rawTitle || !rawContent) {
    return {
      ok: false,
      message: 'Memory title and content are required.',
      reason: 'empty_content',
      isError: true,
    };
  }
  if (
    DISALLOWED_SENSITIVE_CONTENT_PATTERN.test(rawTitle) ||
    DISALLOWED_SENSITIVE_CONTENT_PATTERN.test(rawContent)
  ) {
    return {
      ok: false,
      message: 'Sensitive content cannot be saved as workspace memory.',
      reason: 'sensitive_content',
      isError: true,
    };
  }

  const title = normalizeExplicitMemoryField(rawTitle, MAX_EXPLICIT_TITLE_CHARACTERS);
  const content = normalizeExplicitMemoryField(rawContent, MAX_EXPLICIT_CONTENT_CHARACTERS);
  if (isEffectivelyEmptyMemoryField(title) || isEffectivelyEmptyMemoryField(content)) {
    return {
      ok: false,
      message: 'Memory content is empty after applying privacy redaction.',
      reason: 'empty_content',
      isError: true,
    };
  }

  const sensitivity =
    /<private>[\s\S]*?<\/private>/i.test(rawTitle) ||
    /<private>[\s\S]*?<\/private>/i.test(rawContent)
      ? MemorySensitivity.Sensitive
      : MemorySensitivity.Normal;

  return {
    ok: true,
    memory: {
      title,
      content,
      kind: input.kind,
      importance: EXPLICIT_MEMORY_DEFAULT_IMPORTANCE,
      confidence: EXPLICIT_MEMORY_DEFAULT_CONFIDENCE,
      sensitivity,
      metadata: { source: EXPLICIT_MEMORY_SOURCE },
    },
  };
}

function normalizeExplicitMemoryField(value: string, maxCharacters: number): string {
  return redactPrivateBlocks(value).replace(/\s+/g, ' ').trim().slice(0, maxCharacters);
}

function isEffectivelyEmptyMemoryField(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  return /^(\[REDACTED\]\s*)+$/i.test(trimmed);
}
