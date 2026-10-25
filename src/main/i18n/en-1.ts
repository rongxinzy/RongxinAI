export const enMain1: Record<string, string> = {
  webSearchToolLabel: 'Web search',
  webSearchInvalidInput: 'Invalid search query or result count.',
  webSearchInvalidResponse: 'Search returned an invalid or oversized response.',
  webSearchRequestFailed: 'Search request failed (HTTP {status}).',
  workbenchDeliveryHashFailed: 'Final deliverable content verification failed.',
  workbenchDeliveryNotReady: 'The result is not ready for delivery and cannot be accepted.',
  workbenchDeliverablesRequireAcceptance: '{count} final deliverable(s) require user acceptance.',
  workbenchArtifactCollectionFailed:
    'Artifact collection failed; the result cannot be accepted yet.',
  todoReminderTitle: 'Todo reminder',
  todoReminderBody: 'Due now: {title}',
  scheduledTaskDeliveryAccountMismatch:
    'The channel account does not match the selected conversation',
  // Tray menu
  trayShowWindow: 'Open 知远',
  trayNewTask: 'New Task',
  traySettings: 'Settings',
  trayQuit: 'Quit',
  desktopPetTitle: 'Desktop companion',
  desktopPetOpen: 'Open ZhiYuan Agent',
  desktopPetOpenTask: 'View current task',
  desktopPetGreet: 'Say hello',
  desktopPetActionPeek: 'Peek sideways',
  desktopPetActionNod: 'Nod',
  desktopPetActionFlutter: 'Stretch out',
  desktopPetReset: 'Return to screen corner',
  desktopPetHide: 'Hide companion',
  desktopPet_idle: 'Right here',
  desktopPet_thinking: 'Working on a task',
  desktopPet_waiting: 'Waiting for your approval',
  desktopPet_completed: 'Task completed',
  desktopPet_error: 'Task needs attention',
  desktopPet_greeting: 'Hello',
  desktopPet_bubble_thinking: 'Working',
  desktopPet_bubble_waiting: 'Needs approval',
  desktopPet_bubble_completed: 'Done',
  desktopPet_bubble_error: 'Issue',
  desktopPet_chatter_1: 'Hi.',
  desktopPet_chatter_2: 'Right here.',
  desktopPet_chatter_3: 'A little stretch.',
  desktopPet_chatter_4: 'Call me for a chat.',
  desktopPet_chatter_5: 'Time for some water?',
  desktopPet_chatter_6: 'Any new ideas?',
  desktopPet_chatter_7: 'Changing position.',
  desktopPet_chatter_8: 'Take your time.',
  desktopPet_chatter_9: 'Blink, blink.',
  desktopPet_chatter_10: 'A moment to rest.',
  desktopPet_chatter_action_happy: 'Hehe!',
  desktopPet_chatter_action_peek: 'Just a peek~',
  desktopPet_chatter_action_nod: 'Mhm',
  desktopPet_chatter_action_flutter: 'A little stretch.',
  // Session titles
  coworkDefaultSessionTitle: 'New Chat',
  codingAgentDefaultMissionTitle: 'New coding task',
  codingAgentSessionRecovery:
    'The previous agent session could not be restored. A handoff summary was sent to a new session.',
  codingAgentNextStageFailed:
    'Failed to start the next collaboration stage automatically. The target stage is still planned; start the handoff manually from its session.',
  codingAgentConfigModel: 'Model',
  codingAgentConfigThinkingLevel: 'Thinking level',
  codingAgentConfigPermissionMode: 'Permission mode',
  codingAgentConfigPlanMode: 'Plan mode',
  mcpIntegrationOperationBusy:
    'This MCP integration is busy with another operation. Try again shortly.',
  codingAgentPlanModeExecute: 'Execute directly',
  codingAgentPlanModePlan: 'Plan only (read-only)',
  codingAgentPermissionModeAsk: 'Ask every time',
  codingAgentPermissionModeAuto: 'Auto-approve low risk',
  codingAgentPermissionModeAllowAll: 'Allow all',
  codingAgentNoAssistantResponse:
    'The external agent returned no assistant content. Check its sign-in state, model configuration, and network connection.',
  codingAgentStopRefusal:
    'The external agent refused to continue this turn, so no further content was generated.',
  codingAgentStopMaxTokens:
    'The external agent reached its output limit, so this turn may be incomplete.',
  codingAgentCommandGoalDescription:
    'Run in goal mode: the agent iterates on its own until the goal is met.',
  codingAgentCommandGoalHint: 'Describe the goal to reach',
  codingAgentCommandSkillDescription: 'Apply an installed skill to this session.',
  codingAgentCommandSkillHint: 'Skill name',
  codingAgentCommandSkillNone: 'No skill',
  codingAgentCommandExpertDescription: 'Apply an installed expert to this session.',
  codingAgentCommandExpertHint: 'Expert name',
  codingAgentCommandExpertNone: 'No expert',
  codingAgentCommandPlanDescription:
    'Investigate read-only and produce an implementation plan without changing files.',
  codingAgentCommandPlanHint: 'Describe the task to plan',
  codingAgentCommandCompact: 'Compact the current session context',
  codingAgentCommandStatus: 'Show local session status',
  codingAgentCommandCompactSuccess: 'The current session context was compacted.',
  codingAgentCommandCompactCancelled: 'Session context compaction was cancelled.',
  codingAgentCommandCompactNotNeeded: 'This session is too small to compact.',
  codingAgentCommandCompactFailed: 'Session context compaction failed: {error}',
  codingAgentCommandFailed: 'Built-in command failed: {error}',
  codingAgentCommandStatusResult:
    'Local session status: {status}; model: {model}; thinking level: {thinkingLevel}; context compaction: {compaction}',
  codingAgentCommandStatusRunning: 'running',
  codingAgentCommandStatusIdle: 'idle',
  codingAgentCommandStatusDefaultModel: 'default model',
  codingAgentCommandStatusUnknown: 'unknown',
  codingAgentCommandStatusAvailable: 'available',
  codingAgentCommandStatusUnavailable: 'unavailable',
  codingAgentCommandQueueUnavailable: 'The command queue is unavailable.',
  codingAgentCommandCompactionUnavailable: 'Context compaction is unavailable.',
  codingAgentCommandCompactNoSession: 'There is no session context to compact yet.',
  codingAgentCommandMcpDescription: 'Show the MCP servers and tools available to this session.',
  codingAgentCommandMcpHint: 'Server name',
  codingAgentCommandMcpNoServers: 'MCP: no servers are configured.',
  codingAgentCommandMcpServerUnknown: 'MCP: no server named "{name}" is configured.',
  codingAgentCommandMcpSummary:
    'MCP: {connected} of {configured} servers usable, {tools} tools in total.',
  codingAgentCommandMcpServerConnected: '- {name}: connected, {tools} tool(s)',
  codingAgentCommandMcpServerEmpty: '- {name}: connected, but no tools were discovered',
  codingAgentCommandMcpServerFailed: '- {name}: connection failed ({error})',
  codingAgentCommandMcpServerUnreachable: '- {name}: connection failed',
  codingAgentCommandMcpServerDisabled: '- {name}: disabled',
  codingAgentCommandMcpGatewayUnavailable: 'MCP tools are not attached to this coding session.',
  codingAgentCommandMcpTools: 'Available tools:',
  codingAgentCommandMcpToolsOmitted: '... {count} more tool(s) not listed.',
  codingAgentElicitationAnsweredPrompt: 'The user answered your pending question:',
  codingAgentElicitationCancelledByUser: 'The user cancelled this question.',
  codingAgentElicitationCancelledBySessionStop:
    'The coding session stopped, so this question was cancelled.',
  codingAgentElicitationCancelledByRestart:
    'The application restarted, so this question was cancelled.',
  codingAgentElicitationPromptBlocked:
    'Answer or cancel the current question before sending another message.',
  codingAgentElicitationResponseRequired: 'Enter an answer to the question.',
  codingAgentElicitationNoLongerPending: 'This question is no longer awaiting an answer.',
  codingAgentElicitationBuiltinOnly:
    'Only the built-in coding agent supports this question interaction.',
  cronSessionPrefix: 'Cron',
  channelPrefixFeishu: 'Feishu',
  channelPrefixDingtalk: 'DingTalk',
  channelPrefixWecom: 'WeCom',
  channelPrefixWeixin: 'WeChat',
  channelPrefixEmail: 'Email',
  channelPrefixQq: 'QQ',
  channelPrefixTelegram: 'Telegram',
  channelPrefixDiscord: 'Discord',
  channelConversationTitle: '{channel} conversation · {id}',
  channelConversationFallback: '{channel} conversation',
  taskTimedOut:
    '[Task timed out] The task was automatically stopped because it exceeded the maximum allowed duration. You can continue the conversation to pick up where it left off.',
  imSessionStoppedReply:
    'The task was manually stopped. You can send a new message to start a fresh conversation.',
  // OAuth flow messages
  qwenOAuthRequestingDeviceCode: 'Requesting device authorization code...',
  qwenOAuthOpeningBrowser: 'Opening browser for authorization...',
  qwenOAuthWaitingForUser: 'Waiting for user authorization...',
  qwenOAuthSuccess: 'OAuth authorization successful',
  qwenOAuthFailed: 'OAuth authorization failed',
  qwenOAuthTimeout: 'OAuth authorization timeout',
  // Thinking-only hint
  taskThinkingOnly:
    '[No output] The model finished thinking but did not generate a visible reply. You can continue the conversation to ask it to output the result.',
  // Feishu bot install
  feishuVerifyCredentialsFailed:
    'Credential validation failed. Please check your App ID and App Secret.',
  feishuVerifyFailed: 'Verification failed',
  // Cowork error messages
  coworkErrorAuthInvalid: 'Invalid or expired API key. Please check your configuration.',
  coworkErrorInsufficientBalance: 'Insufficient API balance. Please top up and try again.',
  coworkErrorInputTooLong: 'Input too long, exceeding model context limit.',
  coworkErrorCouldNotProcessPdf: 'Unable to process the PDF file.',
  coworkErrorModelNotFound: 'The requested model does not exist or is unavailable.',
  coworkErrorGatewayDisconnected: 'AI engine connection lost. Please retry.',
  coworkErrorServiceRestart: 'AI engine is restarting. Please try again later.',
  coworkErrorGatewayDraining: 'AI engine is restarting. Please wait a moment and try again.',
  coworkErrorNetworkError: 'Network connection failed. Please check your network settings.',
  coworkErrorRateLimit: 'Too many requests. Please try again later.',
  coworkErrorContentFiltered:
    'Content did not pass the safety review. Please modify and try again.',
  coworkErrorServerError: 'Server error occurred. Please try again later.',
  coworkErrorEngineNotReady: 'AI engine is starting up. Please wait a few seconds and try again.',
  coworkLlamaCppModelNotRunning:
    'This local inference model is not running. Load it from Local Inference first or choose another model.',
  coworkLlamaCppContextWindowUnknown:
    'The running local inference model did not report an effective context window. Reload it from Local Inference before sending again.',
  coworkLlamaCppContextWindowTooSmall:
    'This local inference model is currently running with too small a context window ({current}); Agent engine requires at least {required}. Increase ctx-size and reload the model.',
  coworkLlamaCppTrainingContextTooSmall:
    "This local inference model was trained for only {trained} context tokens, below Agent engine's minimum requirement of {required}. Choose a larger-context model for agent and scheduled-task use.",
  coworkLocalModelToolCallingUnsupported:
    'The selected local model does not support tool calling and cannot run Work mode. Choose a model with tool-calling support.',
  coworkLocalModelToolCallingUnknown:
    'The selected local model has unknown tool-calling support. Detect or configure it before running Work mode.',
  coworkLlamaCppContextLimitReached:
    'This local inference session is already near its context limit ({used} / {limit} tokens). Start a new session (/new) or switch to a larger-context model.',
  llamacppUnloadVramRecoveryPending:
    'The model has been removed from the local inference running list, but VRAM may still be reclaiming. Wait a moment before checking again.',
  llamacppUnloadConfirmationPending:
    'The unload request was sent, but the app has not yet confirmed that the model fully disappeared from the running list. Wait a few seconds and check again.',
  llamacppLaunchContextExceedsTrainingLimit:
    'The requested load context {requested} exceeds the model training limit {trained}. Lower ctx-size before loading the model.',
};
