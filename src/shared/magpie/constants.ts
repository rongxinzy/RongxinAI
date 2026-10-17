/** Magpie upstream agent ids exposed in the product UI (aliases map to canonical ids). */
export const MagpieExternalAgentId = {
  ClaudeCode: 'claude-code',
  OpenCode: 'opencode',
  Gemini: 'gemini',
  Pi: 'pi',
  Codex: 'codex',
} as const;

export type MagpieExternalAgentId =
  (typeof MagpieExternalAgentId)[keyof typeof MagpieExternalAgentId];

/** IPC allow-list: user-facing ids plus upstream canonical ids where they differ. */
const MAGPIE_MANAGED_AGENT_IDS = [
  MagpieExternalAgentId.ClaudeCode,
  'claude',
  MagpieExternalAgentId.OpenCode,
  MagpieExternalAgentId.Gemini,
  MagpieExternalAgentId.Pi,
  MagpieExternalAgentId.Codex,
] as const;

const MANAGED_SET = new Set<string>(MAGPIE_MANAGED_AGENT_IDS);

export function isMagpieManagedAgentId(id: string): boolean {
  return MANAGED_SET.has(id);
}

/** Rows shown in the external-agent panel, in display order. */
export const MAGPIE_EXTERNAL_AGENT_CATALOG: ReadonlyArray<{
  id: MagpieExternalAgentId;
  upstreamIds: readonly string[];
}> = [
  { id: MagpieExternalAgentId.ClaudeCode, upstreamIds: ['claude', 'claude-code'] },
  { id: MagpieExternalAgentId.OpenCode, upstreamIds: ['opencode'] },
  { id: MagpieExternalAgentId.Gemini, upstreamIds: ['gemini'] },
  { id: MagpieExternalAgentId.Pi, upstreamIds: ['pi'] },
  { id: MagpieExternalAgentId.Codex, upstreamIds: ['codex'] },
];

export function resolveMagpieExternalAgentRowId(upstreamId: string): MagpieExternalAgentId | null {
  const normalized = upstreamId.trim().toLowerCase();
  for (const entry of MAGPIE_EXTERNAL_AGENT_CATALOG) {
    if (entry.upstreamIds.some(candidate => candidate === normalized)) return entry.id;
  }
  return null;
}
