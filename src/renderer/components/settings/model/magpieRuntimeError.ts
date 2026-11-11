/** True for Magpie's HTML-response error, which a Base URL without /v1 produces. */
export function isHtmlEndpointRuntimeError(raw: string): boolean {
  return /answered\s+\d+[^"]*with a web page\s*\(text\/html\)/i.test(raw);
}
