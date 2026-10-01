/** Theme hooks for the existing AI Elements Tool composition. */
export const CHAT_TOOL_SELECTORS = {
  'chat-tool': '.theme-chat-tool',
  'chat-tool-trigger': '.theme-chat-tool-trigger',
  'chat-tool-icon': '.theme-chat-tool-icon',
  'chat-tool-title': '.theme-chat-tool-title',
  'chat-tool-summary': '.theme-chat-tool-summary',
  'chat-tool-status': '.theme-chat-tool-status',
  'chat-tool-warning':
    '.theme-chat-tool-status[data-tool-state="approval-requested"], .theme-chat-tool-status[data-tool-state="output-denied"]',
  'chat-tool-error': '.theme-chat-tool-status[data-tool-state="output-error"]',
  'chat-tool-chevron': '.theme-chat-tool-chevron',
  'chat-tool-chevron-open':
    '.theme-chat-tool-trigger[aria-expanded="true"] .theme-chat-tool-chevron',
  'chat-tool-content': '.theme-chat-tool-content',
  'chat-tool-label': '.theme-chat-tool-label',
  'chat-tool-output-error': '.theme-chat-tool-output-error',
} as const;
