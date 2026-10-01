import {
  CodingAgentCheckFailure,
  CodingAgentCheckPhase,
  CodingAgentProfileStatus,
  type CodingAgentProfile,
} from '../../../shared/codingAgent';

export const checkPhaseLabels: Record<CodingAgentCheckPhase, string> = {
  [CodingAgentCheckPhase.Starting]: 'codingAgentCheckStarting',
  [CodingAgentCheckPhase.Handshake]: 'codingAgentCheckHandshake',
  [CodingAgentCheckPhase.ModelReply]: 'codingAgentCheckModelReply',
  [CodingAgentCheckPhase.Complete]: 'codingAgentCheckComplete',
  [CodingAgentCheckPhase.Failed]: 'codingAgentCheckFailed',
};

export const checkFailureLabels: Record<CodingAgentCheckFailure, string> = {
  [CodingAgentCheckFailure.Authentication]: 'codingAgentCheckAuthHelp',
  [CodingAgentCheckFailure.Startup]: 'codingAgentCheckStartupHelp',
  [CodingAgentCheckFailure.Protocol]: 'codingAgentCheckProtocolHelp',
  [CodingAgentCheckFailure.Timeout]: 'codingAgentCheckTimeoutHelp',
  [CodingAgentCheckFailure.NoReply]: 'codingAgentCheckNoReplyHelp',
  [CodingAgentCheckFailure.Connection]: 'codingAgentCheckConnectionHelp',
};

export function isConnectionCheckRunning(profile: CodingAgentProfile): boolean {
  const phase = profile.connectionCheck?.phase;
  return (
    phase === CodingAgentCheckPhase.Starting ||
    phase === CodingAgentCheckPhase.Handshake ||
    phase === CodingAgentCheckPhase.ModelReply
  );
}

export function canCheckConnection(profile: CodingAgentProfile): boolean {
  return (
    !profile.isBuiltin &&
    Boolean(profile.command) &&
    profile.status !== CodingAgentProfileStatus.Untrusted &&
    profile.status !== CodingAgentProfileStatus.NeedsAdapter &&
    profile.status !== CodingAgentProfileStatus.NeedsConfiguration
  );
}

export function connectionHelpKey(profile: CodingAgentProfile): string {
  if (profile.connectionCheck?.failure) return checkFailureLabels[profile.connectionCheck.failure];
  if (!profile.command) return 'codingAgentCheckNotInstalledHelp';
  if (profile.status === CodingAgentProfileStatus.NeedsAuth) return 'codingAgentCheckAuthHelp';
  if (profile.status === CodingAgentProfileStatus.Incompatible)
    return 'codingAgentCheckProtocolHelp';
  if (profile.status === CodingAgentProfileStatus.Untrusted) return 'codingAgentCheckTrustHelp';
  if (profile.status === CodingAgentProfileStatus.Unavailable)
    return 'codingAgentCheckConnectionHelp';
  return 'codingAgentCheckRequiredHelp';
}
