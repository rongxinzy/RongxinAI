import { CoworkSessionSource } from '../../../shared/cowork/constants';
import type { CoworkSessionSummary } from '../../types/cowork';

/**
 * A folder row highlights only for the section that owns the open session:
 * opening a scheduled session lights up its folder in the automation section,
 * opening an ordinary session lights up the matching folder in the project
 * section. The same workspace appears in both sections, so matching on the
 * workspace alone would highlight two rows at once.
 */
export const isSectionWorkspaceActive = (
  session: CoworkSessionSummary | null | undefined,
  workspaceId: string,
  scheduled: boolean,
): boolean =>
  Boolean(
    session &&
    session.workspaceId === workspaceId &&
    (session.source === CoworkSessionSource.Scheduled) === scheduled,
  );

/**
 * The project folder row follows the selected project, so picking a folder in
 * the project section still highlights it. It yields to the automation section
 * whenever the open session is that workspace's scheduled session — that row is
 * already highlighted there and two highlights at once read as a bug.
 */
export const isProjectWorkspaceActive = (
  session: CoworkSessionSummary | null | undefined,
  workspaceId: string,
  currentWorkspaceId: string | null | undefined,
): boolean =>
  workspaceId === currentWorkspaceId && !isSectionWorkspaceActive(session, workspaceId, true);
