/**
 * Truncates a string to at most `maxChars` UTF-16 code units without splitting
 * astral plane Unicode surrogate pairs (e.g. 4-byte emojis and rare CJK characters).
 *
 * If the boundary code unit is a high surrogate (0xD800–0xDBFF), it is dropped
 * so that no dangling high surrogate remains at the end of the string.
 */
export function safeSlice(str: string, maxChars: number): string {
  if (maxChars <= 0) {
    return '';
  }
  if (str.length <= maxChars) {
    return str;
  }
  const lastCode = str.charCodeAt(maxChars - 1);
  const end = lastCode >= 0xd800 && lastCode <= 0xdbff ? maxChars - 1 : maxChars;
  return str.slice(0, end);
}
