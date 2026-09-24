import { CoworkSessionExpertSource } from '../../../shared/cowork/sessionExperts';

/** Resolve which expert chip to show when the prompt input syncs agent/session state. */
export function resolveInitialSelectedExpertIds(input: {
  sessionId?: string;
  persistedExpertIds: string[];
  currentAgentId?: string;
  currentAgentSource?: string;
}): string[] {
  if (input.sessionId) return input.persistedExpertIds;
  const isExpertAgent =
    input.currentAgentSource === CoworkSessionExpertSource.Package ||
    input.currentAgentSource === CoworkSessionExpertSource.Member;
  if (isExpertAgent && input.currentAgentId) return [input.currentAgentId];
  return input.persistedExpertIds;
}
