/**
 * Limit MCP servers to the IDs or names bound to the active session expert.
 * An expert without bound connectors keeps every enabled server.
 */
export function filterExpertMcpRecords<T extends { id: string; name: string }>(
  records: T[],
  expertMcpIds: string[] | undefined,
): T[] {
  if (!expertMcpIds || expertMcpIds.length === 0) return records;
  return records.filter(r => expertMcpIds.includes(r.id) || expertMcpIds.includes(r.name));
}
