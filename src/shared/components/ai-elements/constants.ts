import type { ToolUIPart } from 'ai';

export const ToolState = {
  ApprovalRequested: 'approval-requested',
  ApprovalResponded: 'approval-responded',
  InputAvailable: 'input-available',
  InputStreaming: 'input-streaming',
  OutputAvailable: 'output-available',
  OutputDenied: 'output-denied',
  OutputError: 'output-error',
} as const satisfies Record<string, ToolUIPart['state']>;
export type ToolState = (typeof ToolState)[keyof typeof ToolState];
