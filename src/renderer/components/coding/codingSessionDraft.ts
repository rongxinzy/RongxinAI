import {
  CodingAgentProfileStatus,
  type CodingAgentProfile,
  type CodingWorkspaceSummary,
} from '../../../shared/codingAgent';
import type { CodingSidebarSelection } from './CodingWorkspaceSidebar';

/** Source folder a new session starts in when the user did not pick one. */
export function resolveDefaultSessionSourceRoot(workspace: CodingWorkspaceSummary): string {
  return workspace.sources[0]?.path ?? workspace.primaryRoot;
}

/** Returns the workspace default agent id when that agent can run right away. */
export function resolveReadyDefaultProfileId(
  profiles: ReadonlyArray<CodingAgentProfile>,
  defaultProfileId: string,
): string | null {
  const profile = profiles.find(candidate => candidate.id === defaultProfileId);
  return profile && profile.status === CodingAgentProfileStatus.Ready ? profile.id : null;
}

/**
 * Builds the selection for a conversation whose session does not exist yet;
 * the session itself is created once the user sends the first prompt.
 */
export function buildCodingSessionDraftSelection(
  workspace: CodingWorkspaceSummary,
  profileId: string,
  sourceRoot?: string,
): CodingSidebarSelection {
  return {
    workspaceId: workspace.id,
    workspaceRoot: workspace.primaryRoot,
    laneId: null,
    draft: {
      id: crypto.randomUUID(),
      workspaceId: workspace.id,
      sourceRoot: sourceRoot ?? resolveDefaultSessionSourceRoot(workspace),
      profileId,
      modelOverride: null,
      sources: workspace.sources,
    },
  };
}
