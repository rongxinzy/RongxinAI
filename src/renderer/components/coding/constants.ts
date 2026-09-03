import { CodingAgentProfileStatus } from '../../../shared/codingAgent';

export const CodingAgentStatusI18nKey: Record<CodingAgentProfileStatus, string> = {
  [CodingAgentProfileStatus.Detected]: 'codingAgentStatusDetected',
  [CodingAgentProfileStatus.Ready]: 'codingAgentReady',
  [CodingAgentProfileStatus.NeedsConfiguration]: 'codingAgentStatusNeedsConfiguration',
  [CodingAgentProfileStatus.NeedsAdapter]: 'codingAgentStatusNeedsAdapter',
  [CodingAgentProfileStatus.NeedsAuth]: 'codingAgentStatusNeedsAuth',
  [CodingAgentProfileStatus.Incompatible]: 'codingAgentStatusIncompatible',
  [CodingAgentProfileStatus.Untrusted]: 'codingAgentStatusUntrusted',
  [CodingAgentProfileStatus.Unavailable]: 'codingAgentStatusUnavailable',
};

export const CodingAgentManagerTab = {
  Local: 'local',
  Custom: 'custom',
} as const;
export type CodingAgentManagerTab =
  (typeof CodingAgentManagerTab)[keyof typeof CodingAgentManagerTab];

export const CodingConversationRole = {
  User: 'user',
  Assistant: 'assistant',
} as const;
export type CodingConversationRole =
  (typeof CodingConversationRole)[keyof typeof CodingConversationRole];

export const CodingConversationActivityKind = {
  Plan: 'plan',
  Tool: 'tool',
  Permission: 'permission',
} as const;
export type CodingConversationActivityKind =
  (typeof CodingConversationActivityKind)[keyof typeof CodingConversationActivityKind];

export const CodingConversationTurnStatus = {
  Complete: 'complete',
  Cancelled: 'cancelled',
  Failed: 'failed',
} as const;
export type CodingConversationTurnStatus =
  (typeof CodingConversationTurnStatus)[keyof typeof CodingConversationTurnStatus];

export const CodingInspectorTab = {
  Changes: 'changes',
  Terminal: 'terminal',
} as const;
export type CodingInspectorTab = (typeof CodingInspectorTab)[keyof typeof CodingInspectorTab];

export const CodingSidePanelView = {
  Git: 'git',
  Inspector: 'inspector',
} as const;
export type CodingSidePanelView = (typeof CodingSidePanelView)[keyof typeof CodingSidePanelView];

export const CodingExternalActivityStatus = {
  Completed: 'completed',
  Failed: 'failed',
  Pending: 'pending',
} as const;

export const CodingToolPartState = {
  ApprovalRequested: 'approval-requested',
  InputAvailable: 'input-available',
  InputStreaming: 'input-streaming',
  OutputAvailable: 'output-available',
  OutputError: 'output-error',
} as const;
export type CodingToolPartState = (typeof CodingToolPartState)[keyof typeof CodingToolPartState];

export const CodingComposerStatus = {
  Submitted: 'submitted',
  Streaming: 'streaming',
  Error: 'error',
} as const;
export type CodingComposerStatus =
  (typeof CodingComposerStatus)[keyof typeof CodingComposerStatus];
