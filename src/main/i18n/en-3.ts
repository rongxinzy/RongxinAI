export const enMain3 = {
  imChannelEnabledNotConnectedSuggestion:
    'Please check the network, bot configuration, and platform-side event settings.',
  imChannelRunning: 'IM channel is enabled and running normally.',
  imChannelNotEnabled: 'IM channel is not currently enabled.',
  imChannelNotEnabledSuggestion: 'Please click the IM channel toggle button to enable it.',
  imNoInboundAfter2Min: 'Connected for over 2 minutes but no inbound messages received.',
  imNoInboundSuggestion:
    'Please verify the bot is in the target conversation, or @mention the bot per platform rules.',
  imInboundDetected: 'Inbound messages detected.',
  imGatewayJustStarted:
    'Gateway just started; inbound activity check will be more accurate after 2 minutes.',
  imNoOutbound: 'Messages received but no successful outbound reply observed.',
  imNoOutboundSuggestion:
    'Please check message send permissions, bot visibility scope, and reply permissions.',
  imOutboundDetected: 'Successful outbound reply detected.',
  imNoInboundForOutboundCheck: 'No inbound messages received yet to evaluate outbound capability.',
  imRecentError: 'Recent error: {error}',
  imRecentErrorConnectedSuggestion:
    'Currently connected, but fixing this error is recommended to prevent future interruptions.',
  imRecentErrorDisconnectedSuggestion:
    'This error may block conversations. Please fix it and retry.',
  imConfigIncomplete: 'Configuration incomplete',
  imUnknownPlatform: 'Unknown platform.',

  // QQ
  imQqMentionHint:
    '@mention the bot in channels to start a conversation. Direct messages and group chats are also supported.',
  imQqAuthPassed: 'QQ authentication passed (AccessToken obtained).',
  imQqAccessTokenFailed: 'Failed to obtain AccessToken',
  imQqFillAppIdSecret: 'Please provide the AppID and AppSecret and test connectivity again.',
  imQqAuthFailed: 'QQ authentication failed: {error}',
  imQqCheckAppIdSecret:
    'Please check that the AppID and AppSecret are correct and that bot permissions are enabled.',

  // Telegram
  imTelegramMissingBotToken: 'Missing required configuration: botToken',
  imTelegramFillBotToken: 'Please provide the Bot Token and test connectivity again.',
  imTelegramAuthPassed: 'Telegram Bot authentication passed: @{username}',
  imTelegramAuthFailed: 'Telegram Bot authentication failed: {error}',
  imTelegramAuthFailedUnknown: 'Unknown error',
  imTelegramCheckToken: 'Please check that the Bot Token is correct.',
  imTelegramCheckTokenNetwork:
    'Please check that the Bot Token is correct and the network is reachable.',

  // Discord
  imDiscordMissingBotToken: 'Missing required configuration: botToken',
  imDiscordFillBotToken: 'Please provide the Bot Token and test connectivity again.',
  imDiscordAuthPassed: 'Discord Bot authentication passed (Bot: {username}).',
  imDiscordAuthFailed: 'Discord Bot authentication failed: {error}',
  imDiscordCheckTokenNetwork:
    'Please check that the Bot Token is correct and the network is reachable.',
  imDiscordGroupMention: 'Discord only responds to @mentioned messages in group chats.',

  // Feishu
  imFeishuFillAppIdSecret: 'Please provide the App ID and App Secret and test connectivity again.',
  imFeishuAuthPassed: 'Feishu authentication passed (Bot: {botName})',
  imFeishuAuthFailed: 'Feishu authentication failed: {error}',
  imFeishuCheckAppIdSecret: 'Please check that the App ID and App Secret are correct.',
  imFeishuGroupMention: 'Feishu only responds to @mentioned messages in group chats.',
  imFeishuGroupMentionSuggestion: 'Please @mention the bot in group chats to start a conversation.',
  imFeishuEventSubscription:
    'Feishu requires the message event subscription (im.message.receive_v1) to receive messages.',
  imFeishuEventSubscriptionSuggestion:
    'Please verify event subscriptions, permissions, and publish status in the Feishu Developer Console.',
  imFeishuAuthPassedWithBot: 'Feishu authentication passed (Bot: {botName}).',

  // DingTalk
  imDingtalkFillClientIdSecret:
    'Please provide the Client ID and Client Secret and test connectivity again.',
  imDingtalkAuthPassed: 'DingTalk authentication passed.',
  imDingtalkAuthFailed: 'DingTalk authentication failed: {error}',
  imDingtalkCheckClientIdSecret:
    'Please check that the Client ID and Client Secret are correct and that bot permissions are enabled.',
  imDingtalkBotMembership:
    'The DingTalk bot must be added to the target conversation with messaging permissions.',
  imDingtalkBotMembershipSuggestion:
    'Please verify the bot is in the target conversation and enterprise permissions allow sending and receiving messages.',

  // WeCom
  imWecomFillBotIdSecret: 'Please provide the Bot ID and Secret and test connectivity again.',
  imWecomConfigReady: 'WeCom configuration is ready (Bot ID: {botId}).',

  // Weixin
  imWeixinNotEnabled: 'WeChat channel is not currently enabled.',
  imWeixinEnableSuggestion: 'Please enable the WeChat channel and test connectivity again.',
  imWeixinConfigReady: 'WeChat configuration is ready.',
  imWeixinAccountMissing: 'WeChat account is not bound. QR code scan is required.',
  imWeixinAccountMissingSuggestion:
    'Please use "Scan to Connect WeChat" in WeChat settings to bind your account.',
  imWeixinGatewayNotRunning: 'Agent engine Gateway is not running. WeChat channel cannot connect.',
  imWeixinGatewayNotRunningSuggestion:
    'Please start the AI engine (Agent engine) first for the WeChat bot to connect.',
  imWeixinChannelProbeFailed: 'Unable to verify WeChat channel status.',
  imWeixinChannelProbeFailedSuggestion:
    'Please try again later. If the issue persists, restart Agent engine Gateway or re-scan the QR code.',
  imWeixinChannelActive: 'WeChat channel connection is active.',
  imWeixinGatewayProbeError: 'WeChat channel health check failed: {error}',
  imChannelActive: '{channel} channel connection is active.',
  imChannelNoSessions: '{channel} channel has no active sessions. The bot may not be connected.',
  imChannelNoSessionsSuggestion:
    'Please confirm the binding is correct and check the bot configuration.',
  imChannelProbeError: 'Channel health check failed: {error}',
  emailSettings: 'Email Settings',
  emailInstance: 'Email Account',
  addEmailInstance: 'Add Email Account',
  emailInstanceName: 'Account Name',
  emailInstanceNamePlaceholder: 'e.g., Work Email',
  emailAddress: 'Email Address',
  emailAddressPlaceholder: 'user@example.com',
  emailPassword: 'Password',
  emailPasswordPlaceholder: 'Email password or app-specific password',
  emailApiKey: 'API Key',
  emailApiKeyPlaceholder: 'ck_live_xxxxxxxx',
  getApiKey: 'Get API Key',
  apiKeyHint:
    'Get the API Key from your email service configuration source or administrator, then paste it here.',
  emailTransportMode: 'Transport Mode',
  emailTransportImap: 'IMAP/SMTP (Traditional)',
  emailTransportWs: 'WebSocket (Secure, no password required)',
  emailAllowFrom: 'Allowed Senders (Whitelist)',
  emailAllowFromPlaceholder: 'user@example.com\n*.trusted-domain.com\n*@company.com',
  emailAllowFromHint: 'Supports wildcards, one per line. Empty = accept all senders.',
  emailAdvancedOptions: 'Advanced Options',
  emailImapSmtpConfig: 'IMAP/SMTP Server Configuration',
  emailImapHost: 'IMAP Host',
  emailImapPort: 'IMAP Port',
  emailSmtpHost: 'SMTP Host',
  emailSmtpPort: 'SMTP Port',
  emailServerConfigHint: 'Leave empty to auto-detect from email domain',
  emailReplyStrategy: 'Reply Strategy',
  emailReplyMode: 'Reply Mode',
  emailReplyModeImmediate: 'Immediate (streaming, one email per block)',
  emailReplyModeAccumulated: 'Accumulated (streaming, buffered)',
  emailReplyModeComplete: 'Complete (wait for full response)',
  emailReplyTo: 'Reply Recipients',
  emailReplyToSender: 'Sender only',
  emailReplyToAll: 'Sender + all recipients',
  emailA2aConfig: 'Agent-to-Agent Configuration',
  emailA2aEnabled: 'Enable A2A',
  emailA2aAgentDomains: 'Agent Domains',
  emailA2aAgentDomainsPlaceholder: 'agents.example.com',
  emailA2aAgentDomainsHint: 'Domains allowed for agent collaboration, one per line',
  emailA2aMaxTurns: 'A2A Max Ping-Pong Turns',
  emailConnectivityFailAlert: 'Connectivity test failed, please check your configuration',
  emailConnected: 'Connected',
  emailDisconnected: 'Disconnected',
  emailSaveSuccess: 'Configuration saved',
  emailSaveError: 'Save failed',
  emailValidationError: 'Configuration validation failed',
  emailMaxInstancesExceeded: 'Maximum {count} email accounts supported',
  emailDuplicateEmail: 'Email address "{email}" is duplicated',
  emailDuplicateInstanceId: 'Instance ID "{id}" is duplicated',
  emailInvalidEmail: 'Invalid email address format',
  emailMissingPassword: 'Instance "{name}" uses IMAP mode but password is missing',
  emailMissingApiKey: 'Instance "{name}" uses WebSocket mode but API Key is missing',
  emailInvalidApiKey: 'Instance "{name}" has invalid API Key format (should start with ck_)',
  emailGatewayRestarting: 'Restarting Agent engine Gateway...',
  emailDeleteConfirm: 'Delete email account "{name}"?',
  emailEnterValidEmailFirst: 'Please enter a valid email address first',
  emailVerifyInBrowserAndPaste: 'Please complete verification in browser, then paste API Key here',
  testConnection: 'Test Connection',
  emailTestSuccess: 'Connection test successful!',
  emailTestFailed: 'Connection test failed: {error}',

  // Community account authentication
  communityAuthLoginIncomplete: 'Login was not completed. Please try again.',
  communityAuthServiceUnavailable:
    'The login service is temporarily unavailable. Please try again later.',
};
