/**
 * Catalogue of the errors the coding feature produces itself.
 *
 * Coding modules throw plain `Error`s. The message crosses IPC as a string and
 * is rendered by the UI, so every message the feature can show to a user is
 * declared here as the single source of truth: the throw sites reference these
 * constants and the renderer resolves the same constants to i18n keys. Rewording
 * a message without touching this file therefore cannot silently drop its
 * translation — the records below are exhaustive over the unions.
 *
 * Third-party text (git stderr, ACP agent output, provider errors) is
 * deliberately absent: it is not ours to translate and falls back to the
 * generic error normalisation.
 */

/** Errors thrown or returned verbatim, with no trailing detail. */
export const CodingErrorMessage = {
  // Workspace
  WorkspaceNotFound: 'Coding workspace was not found.',
  WorkspaceRootRequired: 'Coding workspace root is required.',
  WorkspaceNameRequired: 'Coding workspace name is required.',
  WorkspaceSourceInUse: 'A source folder already belongs to another coding workspace.',
  WorkspacePrimaryInUse: 'A coding workspace already uses this primary source folder.',
  WorkspaceSourceRequired: 'A coding workspace requires at least one source folder.',
  WorkspaceSourceRootForbidden: 'A filesystem root cannot be used as a coding workspace source.',
  WorkspaceSourceNotRemovable: 'A source folder with existing coding sessions cannot be removed.',
  WorkspacePrimaryLocked:
    'The primary source folder cannot change after a coding session is created.',
  WorkspaceSessionsRunning: 'Stop all running coding sessions before removing this workspace.',
  WorkspaceTargetOutside: 'The target is outside the authorized coding workspace.',
  WorkspaceTargetNoAncestor: 'The target does not have an existing filesystem ancestor.',
  WorkspaceRelativePath: 'Workspace paths must stay inside the selected source folder.',
  SourceFolderNotInWorkspace:
    'The selected source folder does not belong to this coding workspace.',

  // Session and lane
  SessionNotFound: 'The coding session was not found.',
  SessionNotFoundInWorkspace: 'Coding session was not found in this workspace.',
  SessionRunning: 'Stop the running coding session before deleting it.',
  LaneNotFound: 'Coding agent lane was not found.',
  CollaboratorBaselineRequired:
    'Parallel collaborators require a Git workspace with a frozen baseline.',
  WriterLeaseHeld: 'Another agent lane holds the workspace writer lease.',

  // Agent profile
  ProfileNotFound: 'Coding agent profile was not found.',
  ProfileBuiltinNotFound: 'The built-in coding agent profile was not found.',
  ProfileNotReady: 'The selected coding agent is not ready to run.',
  ProfileNotTrustable: 'The coding agent profile cannot be trusted.',
  ProfileNotAuthenticatable:
    'The coding agent profile cannot require external authentication.',
  ProfileNotProbeable: 'The coding agent profile cannot be probed.',
  ProfileNameRequired: 'Coding agent name is required.',
  ProfileCommandAbsolute: 'Custom coding agent commands must use an absolute path.',
  ProfileArgumentsInvalid: 'Custom coding agent command arguments are invalid.',
  ProfileCommandMissing: 'ACP agent has no configured executable.',

  // Prompt and pending messages
  PromptRequired: 'Prompt is required.',
  MessageTextRequired: 'Message text is required.',
  PendingMessageNotFound: 'Pending message was not found.',
  PendingMessageSending: 'A pending message is already being sent.',
  PendingMessageEditWhileSending: 'A pending message cannot be edited while sending.',
  PendingMessageSteerOnly: 'This pending message must be sent as a steer.',
  SteerFailed: 'Failed to steer the coding agent.',
  QueuePromptFailed: 'Failed to queue the coding prompt.',

  // Git
  GitIsolatedReadOnly: 'Isolated collaborator worktrees are read-only in the Git panel.',
  GitAgentBusy: 'Wait for the active coding agent write operation before changing Git state.',
  GitSourceNotInWorkspace: 'Git access is limited to folders in the coding workspace.',
  GitPathRequired: 'Select at least one Git path.',
  GitPathTooMany: 'Too many Git paths were selected.',
  GitPathOutsideRepository: 'Git paths must stay inside the selected repository.',
  GitPullRequestFieldsRequired: 'A pull request title and base branch are required.',
  GitPullRequestUrlMissing: 'GitHub did not return a pull request URL.',
  GitCommitMessageRequired: 'A Git commit message is required.',
  GitCommitMessageTooLong: 'The Git commit message is too long.',
  GitBranchInvalid: 'Invalid Git branch.',
  GitPatchConflict: 'The collaborator patch cannot be applied cleanly.',

  // Authentication terminals
  AuthTerminalGone: 'The authentication terminal is no longer active.',
  AcpTerminalGone: 'The ACP terminal was not found.',

  // Prompt attachments (ACP)
  AttachmentLimit: 'At most 8 attachments can be sent in one prompt.',
  AttachmentPathAbsolute: 'Attached file path must be absolute.',
  AttachmentNotFile: 'Attached path is not a regular file.',
  AttachmentImageTooLarge: 'Attached image exceeds the 10 MB limit.',

  // ACP driver and connection
  AcpAuthMethodUnavailable: 'The requested ACP authentication method is unavailable.',
  AcpTerminalAuthRequired: 'This ACP agent requires interactive terminal authentication.',
  AcpSessionIdMissing: 'ACP agent did not return a session ID.',
  AcpLoadUnsupported: 'The ACP agent does not support loading sessions.',
  AcpPermissionNotPending: 'The ACP permission request is no longer pending.',
  AcpPermissionOptionRequired: 'An ACP permission selection requires an option ID.',
  AcpFileWriteNoContent: 'ACP file write has no text content.',
  AcpTerminalNoCommand: 'ACP terminal creation has no command.',
  AcpFilesystemNoPath: 'ACP filesystem request has no path.',
  AcpWorkspaceBrokerMissing: 'ACP workspace broker is unavailable.',
  AcpTerminalNoId: 'ACP terminal request has no terminal ID.',
  AcpConnectionNotRunning: 'ACP agent connection is not running.',
  AcpProbeTimedOut: 'ACP probe timed out.',
  AgentAuthRequired: 'The coding agent requires authentication.',

  // Built-in driver
  BuiltinAuthNotRequired: 'The built-in coding agent does not require authentication.',
  BuiltinPermissionsRuntime: 'Built-in permissions are handled by the coding runtime.',
  BuiltinConfigOptionNotFound: 'The built-in coding agent configuration option was not found.',
  BuiltinConfigValueInvalid: 'The selected built-in coding agent configuration value is invalid.',

  // Session lifecycle and collaboration
  LaneTurnActive: 'This coding agent lane already has an active turn.',
  RecoveryNotRequired: 'The coding session does not require recovery confirmation.',
  HandoffSameMission: 'Handoffs require lanes in the same coding mission.',
  MissionNotFound: 'Coding mission was not found.',
  MissionNoImplementation: 'The coding mission has no implementation assignment.',
  RuntimeIsolatedUnsupported: 'The coding runtime cannot create an isolated workspace.',
  CollaboratorPreviewIsolatedOnly:
    'Only isolated collaborator worktrees can be previewed for application.',
  CollaboratorApplyIsolatedOnly: 'Only isolated collaborator worktrees can be applied.',
  RuntimeIsolatedDiffUnsupported: 'The coding runtime cannot inspect isolated workspace changes.',
  RuntimeIsolatedApplyUnsupported: 'The coding runtime cannot apply isolated workspace changes.',
  CollaboratorPatchUnsupported: 'The coding runtime cannot materialize a collaborator patch.',
  WorkspaceWriterBusy:
    'Wait for the active workspace writer before applying collaborator changes.',

  // Configuration
  ConfigOptionNotFound: 'The coding agent configuration option was not found.',
  ConfigValueInvalid: 'The selected coding agent configuration value is invalid.',
  ModelSwitchBuiltinOnly: 'Only the built-in coding agent supports switching models here.',

  // Workspace file access
  WorkspacePathNotDirectory: 'The requested workspace path is not a directory.',
  WorkspacePathNotFile: 'The requested workspace path is not a file.',
  FilePreviewNotSelected: 'Select a workspace file to preview.',
  FilePreviewTooLarge: 'Files larger than 512 KB cannot be previewed.',
  FilePreviewBinary: 'Binary files cannot be previewed.',
  FileAccessNotInWorkspace: 'File access is limited to folders in the coding workspace.',

  // Interactive authentication and permissions
  ProfileNotAwaitingAuth: 'The coding agent profile is not waiting for authentication.',
  AuthMethodNotFound: 'The coding agent authentication method was not found.',
  AgentTerminalAuthRequired: 'This coding agent requires interactive terminal authentication.',
  TerminalAuthUnavailable: 'The coding agent terminal authentication method is not available.',
  PermissionRequestNotFound: 'The coding permission request was not found.',
  BuiltinPermissionUnsupported: 'The built-in coding runtime cannot respond to permissions.',

  // Renderer queue
  QueueLoadFailed: 'Failed to load pending messages.',

  // ACP process lifecycle
  AcpPromptCancelled: 'ACP session prompt was cancelled.',
  AcpConnectionDisposed: 'The ACP connection was disposed.',
  AcpAgentConnectionDisposed: 'ACP agent connection was disposed.',
  AcpPermissionNoSession: 'ACP permission request has no session ID.',
  AcpOversizedMessage: 'ACP agent emitted an oversized stdout message.',

  // External agent produced nothing: the usual cause is missing credentials.
  // ACP agents (Kimi Code, Codex, Claude Code) answer a prompt they cannot run
  // with a silent end_turn, so the app has to name the likely cause itself.
  AgentNoOutput: 'The external coding agent returned no content.',
  AgentNoOutputTimeout: 'The external coding agent produced no output in time.',
  /**
   * The connection check reached the agent (ACP handshake fine) but a minimal
   * prompt came back with nothing — the usual shape of an unusable credential or
   * an unreachable model endpoint.
   */
  AgentProbeNoAnswer: 'The external coding agent accepted the connection but answered nothing.',
} as const;
export type CodingErrorMessage = (typeof CodingErrorMessage)[keyof typeof CodingErrorMessage];

/**
 * Interpolated messages: the thrown text is `"<prefix> <detail>"`. The renderer
 * matches the prefix and keeps the detail for the `{detail}` placeholder.
 */
export const CodingErrorDetailMessage = {
  WorkspaceSourceMissing: 'Coding workspace source does not exist:',
  WorkspaceSourceNotDirectory: 'Coding workspace source is not a directory:',
  AgentNotReadyDetail: 'The selected coding agent is not ready to run:',  // → codingErrorProfileNotReadyDetail
  AcpAgentExited: 'ACP agent exited',
  AcpProtocolUnsupported: 'ACP protocol version',
  AcpRequestUnsupported: 'Unsupported ACP agent request:',
  AcpRequestTimedOut: 'ACP request timed out:',
} as const;
export type CodingErrorDetailMessage =
  (typeof CodingErrorDetailMessage)[keyof typeof CodingErrorDetailMessage];

/** i18n key for every message above. The record must stay exhaustive. */
export const CodingErrorI18nKey: Record<CodingErrorMessage | CodingErrorDetailMessage, string> = {
  [CodingErrorMessage.WorkspaceNotFound]: 'codingErrorWorkspaceNotFound',
  [CodingErrorMessage.WorkspaceRootRequired]: 'codingErrorWorkspaceRootRequired',
  [CodingErrorMessage.WorkspaceNameRequired]: 'codingErrorWorkspaceNameRequired',
  [CodingErrorMessage.WorkspaceSourceInUse]: 'codingErrorWorkspaceSourceInUse',
  [CodingErrorMessage.WorkspacePrimaryInUse]: 'codingErrorWorkspacePrimaryInUse',
  [CodingErrorMessage.WorkspaceSourceRequired]: 'codingErrorWorkspaceSourceRequired',
  [CodingErrorMessage.WorkspaceSourceRootForbidden]: 'codingErrorWorkspaceSourceRootForbidden',
  [CodingErrorMessage.WorkspaceSourceNotRemovable]: 'codingErrorWorkspaceSourceNotRemovable',
  [CodingErrorMessage.WorkspacePrimaryLocked]: 'codingErrorWorkspacePrimaryLocked',
  [CodingErrorMessage.WorkspaceSessionsRunning]: 'codingErrorWorkspaceSessionsRunning',
  [CodingErrorMessage.WorkspaceTargetOutside]: 'codingErrorWorkspaceTargetOutside',
  [CodingErrorMessage.WorkspaceTargetNoAncestor]: 'codingErrorWorkspaceTargetNoAncestor',
  [CodingErrorMessage.WorkspaceRelativePath]: 'codingErrorWorkspaceRelativePath',
  [CodingErrorMessage.SourceFolderNotInWorkspace]: 'codingErrorSourceFolderNotInWorkspace',
  [CodingErrorMessage.SessionNotFound]: 'codingErrorSessionNotFound',
  [CodingErrorMessage.SessionNotFoundInWorkspace]: 'codingErrorSessionNotFoundInWorkspace',
  [CodingErrorMessage.SessionRunning]: 'codingErrorSessionRunning',
  [CodingErrorMessage.LaneNotFound]: 'codingErrorLaneNotFound',
  [CodingErrorMessage.CollaboratorBaselineRequired]: 'codingErrorCollaboratorBaselineRequired',
  [CodingErrorMessage.WriterLeaseHeld]: 'codingErrorWriterLeaseHeld',
  [CodingErrorMessage.ProfileNotFound]: 'codingErrorProfileNotFound',
  [CodingErrorMessage.ProfileBuiltinNotFound]: 'codingErrorProfileBuiltinNotFound',
  [CodingErrorMessage.ProfileNotReady]: 'codingErrorProfileNotReady',
  [CodingErrorMessage.ProfileNotTrustable]: 'codingErrorProfileNotTrustable',
  [CodingErrorMessage.ProfileNotAuthenticatable]: 'codingErrorProfileNotAuthenticatable',
  [CodingErrorMessage.ProfileNotProbeable]: 'codingErrorProfileNotProbeable',
  [CodingErrorMessage.ProfileNameRequired]: 'codingErrorProfileNameRequired',
  [CodingErrorMessage.ProfileCommandAbsolute]: 'codingErrorProfileCommandAbsolute',
  [CodingErrorMessage.ProfileArgumentsInvalid]: 'codingErrorProfileArgumentsInvalid',
  [CodingErrorMessage.ProfileCommandMissing]: 'codingErrorProfileCommandMissing',
  [CodingErrorMessage.PromptRequired]: 'codingErrorPromptRequired',
  [CodingErrorMessage.MessageTextRequired]: 'codingErrorMessageTextRequired',
  [CodingErrorMessage.PendingMessageNotFound]: 'codingErrorPendingMessageNotFound',
  [CodingErrorMessage.PendingMessageSending]: 'codingErrorPendingMessageSending',
  [CodingErrorMessage.PendingMessageEditWhileSending]: 'codingErrorPendingMessageEditWhileSending',
  [CodingErrorMessage.PendingMessageSteerOnly]: 'codingErrorPendingMessageSteerOnly',
  [CodingErrorMessage.SteerFailed]: 'codingErrorSteerFailed',
  [CodingErrorMessage.QueuePromptFailed]: 'codingErrorQueuePromptFailed',
  [CodingErrorMessage.GitIsolatedReadOnly]: 'codingErrorGitIsolatedReadOnly',
  [CodingErrorMessage.GitAgentBusy]: 'codingErrorGitAgentBusy',
  [CodingErrorMessage.GitSourceNotInWorkspace]: 'codingErrorGitSourceNotInWorkspace',
  [CodingErrorMessage.GitPathRequired]: 'codingErrorGitPathRequired',
  [CodingErrorMessage.GitPathTooMany]: 'codingErrorGitPathTooMany',
  [CodingErrorMessage.GitPathOutsideRepository]: 'codingErrorGitPathOutsideRepository',
  [CodingErrorMessage.GitPullRequestFieldsRequired]: 'codingErrorGitPullRequestFieldsRequired',
  [CodingErrorMessage.GitPullRequestUrlMissing]: 'codingErrorGitPullRequestUrlMissing',
  [CodingErrorMessage.GitCommitMessageRequired]: 'codingErrorGitCommitMessageRequired',
  [CodingErrorMessage.GitCommitMessageTooLong]: 'codingErrorGitCommitMessageTooLong',
  [CodingErrorMessage.GitBranchInvalid]: 'codingErrorGitBranchInvalid',
  [CodingErrorMessage.GitPatchConflict]: 'codingErrorGitPatchConflict',
  [CodingErrorMessage.AuthTerminalGone]: 'codingErrorAuthTerminalGone',
  [CodingErrorMessage.AcpTerminalGone]: 'codingErrorAcpTerminalGone',
  [CodingErrorMessage.AttachmentLimit]: 'codingErrorAttachmentLimit',
  [CodingErrorMessage.AttachmentPathAbsolute]: 'codingErrorAttachmentPathAbsolute',
  [CodingErrorMessage.AttachmentNotFile]: 'codingErrorAttachmentNotFile',
  [CodingErrorMessage.AttachmentImageTooLarge]: 'codingErrorAttachmentImageTooLarge',
  [CodingErrorMessage.AcpAuthMethodUnavailable]: 'codingErrorAcpAuthMethodUnavailable',
  [CodingErrorMessage.AcpTerminalAuthRequired]: 'codingErrorAcpTerminalAuthRequired',
  [CodingErrorMessage.AcpSessionIdMissing]: 'codingErrorAcpSessionIdMissing',
  [CodingErrorMessage.AcpLoadUnsupported]: 'codingErrorAcpLoadUnsupported',
  [CodingErrorMessage.AcpPermissionNotPending]: 'codingErrorAcpPermissionNotPending',
  [CodingErrorMessage.AcpPermissionOptionRequired]: 'codingErrorAcpPermissionOptionRequired',
  [CodingErrorMessage.AcpFileWriteNoContent]: 'codingErrorAcpFileWriteNoContent',
  [CodingErrorMessage.AcpTerminalNoCommand]: 'codingErrorAcpTerminalNoCommand',
  [CodingErrorMessage.AcpFilesystemNoPath]: 'codingErrorAcpFilesystemNoPath',
  [CodingErrorMessage.AcpWorkspaceBrokerMissing]: 'codingErrorAcpWorkspaceBrokerMissing',
  [CodingErrorMessage.AcpTerminalNoId]: 'codingErrorAcpTerminalNoId',
  [CodingErrorMessage.AcpConnectionNotRunning]: 'codingErrorAcpConnectionNotRunning',
  [CodingErrorMessage.AcpProbeTimedOut]: 'codingErrorAcpProbeTimedOut',
  [CodingErrorMessage.AgentAuthRequired]: 'codingErrorAgentAuthRequired',
  [CodingErrorMessage.BuiltinAuthNotRequired]: 'codingErrorBuiltinAuthNotRequired',
  [CodingErrorMessage.BuiltinPermissionsRuntime]: 'codingErrorBuiltinPermissionsRuntime',
  [CodingErrorMessage.BuiltinConfigOptionNotFound]: 'codingErrorBuiltinConfigOptionNotFound',
  [CodingErrorMessage.BuiltinConfigValueInvalid]: 'codingErrorBuiltinConfigValueInvalid',
  [CodingErrorMessage.LaneTurnActive]: 'codingErrorLaneTurnActive',
  [CodingErrorMessage.RecoveryNotRequired]: 'codingErrorRecoveryNotRequired',
  [CodingErrorMessage.HandoffSameMission]: 'codingErrorHandoffSameMission',
  [CodingErrorMessage.MissionNotFound]: 'codingErrorMissionNotFound',
  [CodingErrorMessage.MissionNoImplementation]: 'codingErrorMissionNoImplementation',
  [CodingErrorMessage.RuntimeIsolatedUnsupported]: 'codingErrorRuntimeIsolatedUnsupported',
  [CodingErrorMessage.CollaboratorPreviewIsolatedOnly]:
    'codingErrorCollaboratorPreviewIsolatedOnly',
  [CodingErrorMessage.CollaboratorApplyIsolatedOnly]: 'codingErrorCollaboratorApplyIsolatedOnly',
  [CodingErrorMessage.RuntimeIsolatedDiffUnsupported]:
    'codingErrorRuntimeIsolatedDiffUnsupported',
  [CodingErrorMessage.RuntimeIsolatedApplyUnsupported]:
    'codingErrorRuntimeIsolatedApplyUnsupported',
  [CodingErrorMessage.CollaboratorPatchUnsupported]: 'codingErrorCollaboratorPatchUnsupported',
  [CodingErrorMessage.WorkspaceWriterBusy]: 'codingErrorWorkspaceWriterBusy',
  [CodingErrorMessage.ConfigOptionNotFound]: 'codingErrorConfigOptionNotFound',
  [CodingErrorMessage.ConfigValueInvalid]: 'codingErrorConfigValueInvalid',
  [CodingErrorMessage.ModelSwitchBuiltinOnly]: 'codingErrorModelSwitchBuiltinOnly',
  [CodingErrorMessage.WorkspacePathNotDirectory]: 'codingErrorWorkspacePathNotDirectory',
  [CodingErrorMessage.WorkspacePathNotFile]: 'codingErrorWorkspacePathNotFile',
  [CodingErrorMessage.FilePreviewNotSelected]: 'codingErrorFilePreviewNotSelected',
  [CodingErrorMessage.FilePreviewTooLarge]: 'codingErrorFilePreviewTooLarge',
  [CodingErrorMessage.FilePreviewBinary]: 'codingErrorFilePreviewBinary',
  [CodingErrorMessage.FileAccessNotInWorkspace]: 'codingErrorFileAccessNotInWorkspace',
  [CodingErrorMessage.ProfileNotAwaitingAuth]: 'codingErrorProfileNotAwaitingAuth',
  [CodingErrorMessage.AuthMethodNotFound]: 'codingErrorAuthMethodNotFound',
  [CodingErrorMessage.AgentTerminalAuthRequired]: 'codingErrorAgentTerminalAuthRequired',
  [CodingErrorMessage.TerminalAuthUnavailable]: 'codingErrorTerminalAuthUnavailable',
  [CodingErrorMessage.PermissionRequestNotFound]: 'codingErrorPermissionRequestNotFound',
  [CodingErrorMessage.BuiltinPermissionUnsupported]: 'codingErrorBuiltinPermissionUnsupported',
  [CodingErrorMessage.QueueLoadFailed]: 'codingErrorQueueLoadFailed',
  [CodingErrorMessage.AcpPromptCancelled]: 'codingErrorAcpPromptCancelled',
  [CodingErrorMessage.AcpConnectionDisposed]: 'codingErrorAcpConnectionDisposed',
  [CodingErrorMessage.AcpAgentConnectionDisposed]: 'codingErrorAcpConnectionDisposed',
  [CodingErrorMessage.AcpPermissionNoSession]: 'codingErrorAcpPermissionNoSession',
  [CodingErrorMessage.AcpOversizedMessage]: 'codingErrorAcpOversizedMessage',
  [CodingErrorMessage.AgentNoOutput]: 'codingErrorAgentNoOutput',
  [CodingErrorMessage.AgentNoOutputTimeout]: 'codingErrorAgentNoOutputTimeout',
  [CodingErrorMessage.AgentProbeNoAnswer]: 'codingErrorAgentProbeNoAnswer',
  [CodingErrorDetailMessage.AcpAgentExited]: 'codingErrorAcpAgentExited',
  [CodingErrorDetailMessage.AcpProtocolUnsupported]: 'codingErrorAcpProtocolUnsupported',
  [CodingErrorDetailMessage.AgentNotReadyDetail]: 'codingErrorProfileNotReadyDetail',
  [CodingErrorDetailMessage.WorkspaceSourceMissing]: 'codingErrorWorkspaceSourceMissing',
  [CodingErrorDetailMessage.WorkspaceSourceNotDirectory]: 'codingErrorWorkspaceSourceNotDirectory',
  [CodingErrorDetailMessage.AcpRequestUnsupported]: 'codingErrorAcpRequestUnsupported',
  [CodingErrorDetailMessage.AcpRequestTimedOut]: 'codingErrorAcpRequestTimedOut',
};

/**
 * Messages whose shape varies with embedded identifiers, matched by pattern.
 * `ACP request <method> failed<code>: <detail>` is assembled field by field in
 * the connection supervisor, so there is no stable prefix to anchor on.
 */
const PATTERN_RULES: Array<{ test: RegExp; key: string }> = [
  { test: /^ACP request .+ failed\b/, key: 'codingErrorAcpRequestFailed' },
];

const DETAIL_PREFIX_RULES: Array<{ prefix: string; key: string }> = Object.values(
  CodingErrorDetailMessage,
).map(prefix => ({ prefix, key: CodingErrorI18nKey[prefix] }));

/**
 * Every i18n key the resolver can return — catalogue plus pattern rules.
 *
 * The renderer derives its "this text is already ours" set from this list, so a
 * pattern-matched message (which has no enum member of its own) is recognised
 * too instead of being wrapped a second time by the toast normaliser.
 */
export const CodingErrorTranslationKeys: string[] = [
  ...new Set([...Object.values(CodingErrorI18nKey), ...PATTERN_RULES.map(rule => rule.key)]),
];

export interface CodingErrorTranslation {
  /** i18n key for the user-facing text. */
  key: string;
  /** Trailing detail extracted after the message prefix, when the message carries one. */
  detail?: string;
}

/**
 * Resolve a raw coding message to its translation. Exact matches win over
 * prefixes so a message never shadows another one.
 */
export function resolveCodingErrorTranslation(message: string): CodingErrorTranslation | null {
  const trimmed = message.trim();
  // `message` is arbitrary agent/third-party text: `constructor` or `__proto__`
  // must not be answered by Object.prototype.
  const exact = Object.hasOwn(CodingErrorI18nKey, trimmed)
    ? CodingErrorI18nKey[trimmed as CodingErrorMessage]
    : undefined;
  if (exact) return { key: exact };

  for (const { prefix, key } of DETAIL_PREFIX_RULES) {
    const expected = `${prefix} `;
    if (!trimmed.startsWith(expected)) continue;
    return { key, detail: trimmed.slice(expected.length).trim() };
  }

  const pattern = PATTERN_RULES.find(rule => rule.test.test(trimmed));
  return pattern ? { key: pattern.key } : null;
}
