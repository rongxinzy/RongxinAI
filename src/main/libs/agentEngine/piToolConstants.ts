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
