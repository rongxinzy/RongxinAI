import { safeSlice } from '../../../shared/lib/safeSlice';

/**
 * Default per-call character cap for host custom tools (`run_skill_script`,
 * `python_execute`, `python_install`), aligned with `read_document` and
 * `subagent` to protect CJK and 64K-window models from multi-megabyte tool dumps.
 */
export const PI_CUSTOM_TOOL_MAX_OUTPUT_CHARS = 30_000;

interface TruncatedToolTextResult {
  text: string;
  truncated: boolean;
  omittedChars: number;
}

const formatTruncationMarker = (omittedChars: number, maxChars: number): string =>
  `\n\n...[truncated ${omittedChars.toLocaleString()} characters; showing head and tail within ${maxChars.toLocaleString()}-char limit]...\n\n`;

const sliceTailSurrogateSafe = (text: string, maxChars: number): string => {
  if (maxChars <= 0) return '';
  if (text.length <= maxChars) return text;
  let start = text.length - maxChars;
  const code = text.charCodeAt(start);
  // Drop an orphaned low surrogate at the tail start boundary.
  if (code >= 0xdc00 && code <= 0xdfff) {
    start += 1;
  }
  return text.slice(start);
};

/**
 * Truncate oversized text while preserving both the head and tail (so initial
 * headers and final error tracebacks both survive) within `maxChars`.
 */
export function truncateToolTextHeadTail(
  text: string,
  maxChars: number = PI_CUSTOM_TOOL_MAX_OUTPUT_CHARS,
): TruncatedToolTextResult {
  if (maxChars <= 0) {
    return { text: '', truncated: text.length > 0, omittedChars: text.length };
  }
  if (text.length <= maxChars) {
    return { text, truncated: false, omittedChars: 0 };
  }

  // Reserve using text.length as an upper bound for omittedChars digit width so
  // the actual marker can never exceed the reserved space.
  const maxMarkerLength = formatTruncationMarker(text.length, maxChars).length;
  const budget = maxChars - maxMarkerLength;
  if (budget < 40) {
    const sliced = safeSlice(text, maxChars);
    return {
      text: sliced,
      truncated: true,
      omittedChars: text.length - sliced.length,
    };
  }

  const headTarget = Math.floor(budget * 0.4);
  const tailTarget = budget - headTarget;
  const head = safeSlice(text, headTarget);
  const tail = sliceTailSurrogateSafe(text, tailTarget);
  const omittedChars = text.length - head.length - tail.length;
  const marker = formatTruncationMarker(omittedChars, maxChars);
  return {
    text: `${head}${marker}${tail}`,
    truncated: true,
    omittedChars,
  };
}
