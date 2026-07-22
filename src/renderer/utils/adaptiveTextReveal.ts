const BASE_CHARACTERS_PER_SECOND = 120;
const CATCH_UP_WINDOW_MS = 300;
const MAX_CHARACTERS_PER_SECOND = 1_600;
const IMMEDIATE_SYNC_BACKLOG = 2_000;
const MARKDOWN_SYNTAX = /(^|\n)\s{0,3}(#{1,6}\s|[-*+]\s|\d+\.\s|>|`{3,}|~{3,})|[`*_~\[\]<>|$]/;

export const isPlainTextStreamingTail = (content: string): boolean => !MARKDOWN_SYNTAX.test(content);

export const shouldResetTextReveal = (previousContent: string, nextContent: string): boolean =>
  !nextContent.startsWith(previousContent);

export const getRevealCharacterCount = (backlog: number, elapsedMs: number): number => {
  if (backlog <= 0) return 0;
  if (backlog >= IMMEDIATE_SYNC_BACKLOG) return backlog;

  const catchUpRate = (backlog * 1_000) / CATCH_UP_WINDOW_MS;
  const charactersPerSecond = Math.min(
    MAX_CHARACTERS_PER_SECOND,
    Math.max(BASE_CHARACTERS_PER_SECOND, catchUpRate),
  );
  return Math.min(backlog, Math.max(1, Math.floor((charactersPerSecond * elapsedMs) / 1_000)));
};
