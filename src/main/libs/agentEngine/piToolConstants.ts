export const PiAssistantStopReason = {
  Aborted: 'aborted',
  Error: 'error',
  Length: 'length',
  Stop: 'stop',
  ToolUse: 'toolUse',
} as const;

export const PiBuiltinFileToolName = {
  Bash: 'bash',
  PowerShell: 'powershell',
  Write: 'write',
  Edit: 'edit',
} as const;

export const PiContentBlockType = {
  Text: 'text',
  ToolCall: 'toolCall',
} as const;

export type PiWriteRecoveryMessage = {
  stopReason?: string;
  content:
    | string
    | Array<{
        type: string;
        text?: string;
        id?: string;
        name?: string;
        arguments?: Record<string, unknown>;
      }>;
};
