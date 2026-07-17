export const AgentDetailTab = {
  Prompt: 'prompt',
  Identity: 'identity',
  User: 'user',
  Skills: 'skills',
  Im: 'im',
  Triage: 'triage',
} as const;

export type AgentDetailTab = (typeof AgentDetailTab)[keyof typeof AgentDetailTab];

export const AgentConfirmDialogVariant = {
  Unsaved: 'unsaved',
  Delete: 'delete',
} as const;

export type AgentConfirmDialogVariant =
  (typeof AgentConfirmDialogVariant)[keyof typeof AgentConfirmDialogVariant];
