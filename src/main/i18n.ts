/**
 * Lightweight i18n module for the Electron main process.
 *
 * Mirrors the renderer's i18nService pattern but runs in Node (no DOM/window).
 * Keeps only the small subset of keys needed by main-process code
 * (tray menu, session titles, etc.).
 *
 * Usage:
 *   import { t, setLanguage } from './i18n';
 *   setLanguage('en');
 *   const label = t('trayShowWindow'); // "Open 知远"
 *   const msg = t('imMissingCredentials', { fields: 'appId, appSecret' });
 */

export type LanguageType = 'zh' | 'en';

const translations: Record<LanguageType, Record<string, string>> = {
  zh: {
    scheduledTaskDeliveryAccountMismatch: '频道账号与所选会话不匹配',
    todoReminderTitle: '待办提醒',
    todoReminderBody: '该完成：{title}',
    // Tray menu
    trayShowWindow: '打开知远',
    trayNewTask: '新建任务',
    traySettings: '设置',
    trayQuit: '退出',

    // Session titles (created by ChannelSessionSync)
    coworkDefaultSessionTitle: '新对话',
    codingAgentDefaultMissionTitle: '新建编程任务',
    codingAgentSessionRecovery: '上一个 Agent 会话无法恢复，已将交接摘要发送到新会话。',
    codingAgentConfigModel: '模型',
    codingAgentConfigThinkingLevel: '思考等级',
    codingAgentConfigPermissionMode: '权限模式',
    codingAgentPermissionModeAsk: '每次询问',
    codingAgentPermissionModeAuto: '自动放行低风险',
    codingAgentPermissionModeAllowAll: '全部允许',
    codingAgentNoAssistantResponse:
      '外部 Agent 未返回助手内容，请检查 Agent 的登录状态、模型配置和网络连接。',
    cronSessionPrefix: '定时',
    channelPrefixFeishu: '飞书',
    channelPrefixDingtalk: '钉钉',
    channelPrefixWecom: '企微',
    channelPrefixWeixin: '微信',
    channelPrefixEmail: '邮件',
    channelConversationTitle: '{channel}会话 · {id}',
    taskTimedOut: '[任务超时] 任务因超过最大允许时长而被自动停止。你可以继续对话以从中断处继续。',
    imSessionStoppedReply: '任务已被手动停止。你可以继续发送消息开始新的对话。',

    // Thinking-only hint
    taskThinkingOnly:
      '[模型未输出内容] 模型已完成思考但未生成可见回复。你可以继续对话，让模型重新输出结果。',

    // Feishu bot install
    feishuVerifyCredentialsFailed: '凭证验证失败，请检查 App ID 和 App Secret 是否正确',
    feishuVerifyFailed: '验证失败',

    // Cowork error messages (shared with renderer via classifyErrorKey)
    coworkErrorAuthInvalid: 'API 密钥无效或已过期，请检查配置。',
    coworkErrorInsufficientBalance: 'API 余额不足，请充值后重试。',
    coworkErrorInputTooLong: '输入内容过长，超出模型上下文限制。',
    coworkErrorCouldNotProcessPdf: '无法处理 PDF 文件。',
    coworkErrorModelNotFound: '请求的模型不存在或不可用。',
    coworkErrorGatewayDisconnected: 'AI 引擎连接中断，请重试。',
    coworkErrorServiceRestart: 'AI 引擎正在重启，请稍后重试。',
    coworkErrorGatewayDraining: 'AI 引擎正在重启中，请稍等片刻后重试。',
    coworkErrorNetworkError: '网络连接失败，请检查网络设置。',
    coworkErrorRateLimit: '请求过于频繁，请稍后再试。',
    coworkErrorContentFiltered: '内容未通过安全审核，请修改后重试。',
    coworkErrorServerError: '服务端出现错误，请稍后重试。',
    coworkErrorEngineNotReady: 'AI 引擎正在启动中，请稍等几秒后重试。',
    coworkLlamaCppModelNotRunning:
      '该本地推理模型当前未运行。请先到本地推理页加载模型，或改选其他模型。',
    coworkLlamaCppContextWindowUnknown:
      '该本地推理模型当前未报告实际可用上下文窗口。请先重新加载模型，确认运行上限已显示后再发送。',
    coworkLlamaCppContextWindowTooSmall:
      '该本地推理模型当前运行上下文过小（当前 {current}，Agent 引擎至少需要 {required}）。请调大 ctx-size 后重新加载模型。',
    coworkLlamaCppTrainingContextTooSmall:
      '该本地推理模型的训练上下文上限只有 {trained}，低于Agent 引擎所需的至少 {required}，无法用于当前 agent / 定时任务能力。请改用更大上下文模型。',
    coworkLocalModelToolCallingUnsupported:
      '该本地模型不支持工具调用，无法运行 Work 模式，请改用支持工具调用的模型。',
    coworkLocalModelToolCallingUnknown:
      '该本地模型的工具调用能力未知，请先完成探测或配置后再运行 Work。',
    coworkLlamaCppContextLimitReached:
      '该本地推理会话当前已接近上下文上限（约 {used} / {limit} tokens）。请先新建会话（/new）或切换更大上下文模型。',
    llamacppUnloadVramRecoveryPending:
      '模型已从本地推理运行列表移除，但显存仍可能在继续回收，请稍等片刻再观察。',
    llamacppUnloadConfirmationPending:
      '卸载请求已发出，但应用暂时还没确认该模型已完全从运行列表移除。请稍等几秒后再观察。',
    llamacppLaunchContextExceedsTrainingLimit:
      '该模型请求加载上下文 {requested} 已超过训练上限 {trained}，请调低 ctx-size 后再启动。',
    llamacppLaunchContextClampedToTrainingLimit:
      '请求上下文 {requested} 已超过模型训练上限 {trained}，已按 {effective} 启动。',
    llamacppLoadModelLimitReached: '模型数量达到上限，请卸载模型后重试。',
    llamacppLoadModelGpuNotFound: '未检测到可用 GPU，请检查显卡驱动或 CUDA 环境后重试。',
    llamacppLoadModelGpuProbeFailed: 'GPU 环境检测失败，请检查显卡驱动或 CUDA 环境后重试。',
    llamacppLoadModelVramInsufficient: '显存不足，请检查显存余量或卸载模型后重试。',
    llamacppLoadModelSystemMemoryInsufficient: '系统内存不足，请关闭其他程序后重试。',
    llamacppLoadModelContextTooLarge: '模型上下文过大，系统已尝试降低配置后仍无法加载。',
    llamacppLoadModelFileInvalid: '模型文件异常，请重新下载或导入模型。',
    llamacppLoadModelNotFound: '未找到模型文件，请重新下载或导入模型。',
    llamacppLoadModelServiceUnavailable: '本地推理服务异常，请稍后重试。',
    llamacppLoadModelStartupTimeout: '模型加载时间过长，请稍后重试或降低模型配置。',
    llamacppModelLoadCancelled: '模型启动已取消。',
    llamacppLoadModelUnknown: '模型加载失败，请稍后重试。',
    llamacppModelLoadInProgress: '已有模型正在加载，请等待完成后再试。',
    llamacppServiceStartupPortInUse:
      '本地推理服务端口已被占用，请检查端口设置或关闭占用端口的程序后重试。',
    llamacppServiceStartupProcessExited: '本地推理服务启动后异常退出，请稍后重试。',
    llamacppServiceStartupTimeout: '本地推理服务启动超时，请稍后重试。',
    llamacppServiceStartupBackendUnavailable:
      '当前本地推理运行时后端不可用，请检查显卡驱动或运行时配置。',
    llamacppServiceStartupRuntimeDamaged:
      '本地推理 runtime 不可用或可能已损坏，请重新安装应用后重试。',
    llamacppServiceStartupUnknown: '本地推理服务启动失败，请稍后重试。',
    llamacppModelLaunchLogWindowTitle: '模型启动日志',
    localInferenceImportRuntimeDialogTitle: '选择本地推理 backend',
    localInferenceImportRuntimeDialogMessage:
      '请选择本地推理 backend 主包压缩包（zip 或 tar.gz）；如果已经解压，请进入目录后选择其中任意文件。知远智能体 会校验平台和 backend 类型后导入。',
    coworkErrorUnknown: '任务执行出错，请重试。如果问题持续出现，请检查模型配置。',
    imErrorPrefix: '处理消息时出错',

    // IM error replies (differentiated by error kind)
    imErrorAuthExpired: 'AI 助手认证已过期，请打开应用更新 API 密钥。',
    imErrorRateLimited: 'AI 助手请求过于频繁，请稍后重试。',
    imErrorBudgetExceeded: 'AI 助手账户余额不足，请充值后重试。',
    imErrorEngineNotReady: 'AI 引擎正在启动中，请稍候再试。',
    imErrorTransient: 'AI 助手暂时不可用 ({error})，正在自动恢复中，请稍后重试。',
    imErrorContentFiltered: '消息内容未通过安全审核，请修改后重试。',
    imErrorInputTooLong: '消息内容过长，请精简后重试。',
    imErrorExecutionLimit: '任务执行超时或达到上限，请简化需求后重试。',
    imErrorUnknown: '处理消息时遇到错误: {error}。请稍后重试。',

    // Exec approval continuation
    execApprovalApproved: '用户已确认执行该命令，请检查执行结果并继续。',
    execApprovalDenied: '用户已拒绝执行该命令。',

    // Skill manager errors
    skillErrNoSkillMd: '来源中未找到 SKILL.md',
    skillErrInvalidSource:
      '无效的技能来源。支持 owner/repo、仓库链接、npm 包名、ModelScope 技能链接或 GitHub tree/blob 链接。',
    skillErrModelScopeInstallUnavailable:
      '此 ModelScope 技能未提供可安装的源码或压缩包链接，请在 ModelScope 页面查看安装说明。',
    skillErrAlreadyInstalled: '技能 {name} 已安装。如需覆盖安装，请先删除旧版本后重试。',

    // Gateway startup phases
    gatewayStartupPrecompiling: '正在预编译网关模块...',
    gatewayStartupCompiling: '正在编译网关模块...',
    gatewayStartupLoadingModules: '正在加载网关模块...',
    gatewayStartupStarting: '正在启动 AI 引擎...',

    // Auth quota
    authPlanFree: '免费',
    authPlanStandard: '标准',

    // ── IM connectivity test messages ───────────────────────────────────
    // Common
    imMissingCredentials: '缺少必要配置项: {fields}',
    imFillCredentials: '请补全配置后重新测试连通性。',
    imAuthProbeTimeout: '鉴权探测超时',
    imAuthFailed: '鉴权失败: {error}',
    imAuthFailedSuggestion: '请检查 ID/Secret/Token 是否正确，且机器人权限已开通。',
    imWeixinReconnectRequired: '微信频道需要重新授权后才能连接。',
    imChannelEnabledNotConnected: 'IM 渠道已启用但当前未连接。',
    imChannelEnabledNotConnectedSuggestion: '请检查网络、机器人配置和平台侧事件开关。',
    imChannelRunning: 'IM 渠道已启用且运行正常。',
    imChannelNotEnabled: 'IM 渠道当前未启用。',
    imChannelNotEnabledSuggestion: '请点击对应 IM 渠道胶囊按钮启用该渠道。',
    imNoInboundAfter2Min: '已连接超过 2 分钟，但尚未收到任何入站消息。',
    imNoInboundSuggestion: '请确认机器人已在目标会话中，或按平台规则 @机器人 触发消息。',
    imInboundDetected: '已检测到入站消息。',
    imGatewayJustStarted: '网关刚启动，入站活动检查将在 2 分钟后更准确。',
    imNoOutbound: '已收到消息，但尚未观察到成功回发。',
    imNoOutboundSuggestion: '请检查消息发送权限、机器人可见范围和会话回包权限。',
    imOutboundDetected: '已检测到成功回发消息。',
    imNoInboundForOutboundCheck: '尚未收到可用于评估回发能力的入站消息。',
    imRecentError: '最近错误: {error}',
    imRecentErrorConnectedSuggestion: '当前已连接，但建议修复该错误避免后续中断。',
    imRecentErrorDisconnectedSuggestion: '该错误可能阻断对话，请优先修复后重试。',
    imConfigIncomplete: '配置不完整',
    imUnknownPlatform: '未知平台。',

    // QQ
    imQqMentionHint: '频道中需 @机器人 触发对话，也支持私信和群聊。',
    imQqAuthPassed: 'QQ 鉴权通过（AccessToken 已获取）。',
    imQqAccessTokenFailed: '获取 AccessToken 失败',
    imQqFillAppIdSecret: '请补全 AppID 和 AppSecret 后重新测试连通性。',
    imQqAuthFailed: 'QQ 鉴权失败: {error}',
    imQqCheckAppIdSecret: '请检查 AppID 和 AppSecret 是否正确，且机器人权限已开通。',

    // Telegram
    imTelegramMissingBotToken: '缺少必要配置项: botToken',
    imTelegramFillBotToken: '请补全 Bot Token 后重新测试连通性。',
    imTelegramAuthPassed: 'Telegram Bot 鉴权通过: @{username}',
    imTelegramAuthFailed: 'Telegram Bot 鉴权失败: {error}',
    imTelegramAuthFailedUnknown: '未知错误',
    imTelegramCheckToken: '请检查 Bot Token 是否正确。',
    imTelegramCheckTokenNetwork: '请检查 Bot Token 是否正确，且网络通畅。',

    // Discord
    imDiscordMissingBotToken: '缺少必要配置项: botToken',
    imDiscordFillBotToken: '请补全 Bot Token 后重新测试连通性。',
    imDiscordAuthPassed: 'Discord Bot 鉴权通过（Bot: {username}）。',
    imDiscordAuthFailed: 'Discord Bot 鉴权失败: {error}',
    imDiscordCheckTokenNetwork: '请检查 Bot Token 是否正确，且网络通畅。',
    imDiscordGroupMention: 'Discord 群聊中仅响应 @机器人的消息。',

    // Feishu
    imFeishuFillAppIdSecret: '请补全 App ID 和 App Secret 后重新测试连通性。',
    imFeishuAuthPassed: '飞书鉴权通过（Bot: {botName}）',
    imFeishuAuthFailed: '飞书鉴权失败: {error}',
    imFeishuCheckAppIdSecret: '请检查 App ID 和 App Secret 是否正确。',
    imFeishuGroupMention: '飞书群聊中仅响应 @机器人的消息。',
    imFeishuGroupMentionSuggestion: '请在群聊中使用 @机器人 + 内容触发对话。',
    imFeishuEventSubscription: '飞书需要开启消息事件订阅（im.message.receive_v1）才能收消息。',
    imFeishuEventSubscriptionSuggestion: '请在飞书开发者后台确认事件订阅、权限和发布状态。',
    imFeishuAuthPassedWithBot: '飞书鉴权通过（Bot: {botName}）。',

    // DingTalk
    imDingtalkFillClientIdSecret: '请补全 Client ID 和 Client Secret 后重新测试连通性。',
    imDingtalkAuthPassed: '钉钉鉴权通过。',
    imDingtalkAuthFailed: '钉钉鉴权失败: {error}',
    imDingtalkCheckClientIdSecret:
      '请检查 Client ID 和 Client Secret 是否正确，且机器人权限已开通。',
    imDingtalkBotMembership: '钉钉机器人需被加入目标会话并具备发言权限。',
    imDingtalkBotMembershipSuggestion: '请确认机器人在目标会话中，且企业权限配置允许收发消息。',

    // WeCom
    imWecomFillBotIdSecret: '请补全 Bot ID 和 Secret 后重新测试连通性。',
    imWecomConfigReady: '企业微信配置已就绪（Bot ID: {botId}）。',

    // Weixin
    imWeixinNotEnabled: '微信渠道当前未启用。',
    imWeixinEnableSuggestion: '请启用微信渠道后重新测试连通性。',
    imWeixinConfigReady: '微信配置已就绪。',
    imWeixinAccountMissing: '尚未绑定微信账号，需要扫码登录。',
    imWeixinAccountMissingSuggestion: '请在微信设置中点击"扫码连接微信"完成账号绑定。',
    imWeixinGatewayNotRunning: 'Agent 引擎 Gateway 未启动，微信频道无法连接。',
    imWeixinGatewayNotRunningSuggestion:
      '请先启动 AI 引擎（Agent 引擎），微信 Bot 才会连接微信服务器。',
    imWeixinChannelProbeFailed: '无法确认微信频道状态。',
    imWeixinChannelProbeFailedSuggestion:
      '请稍后重试。如果问题持续，尝试重启Agent 引擎 Gateway 或重新扫码绑定。',
    imWeixinChannelActive: '微信频道连接状态正常。',
    imWeixinGatewayProbeError: '微信频道探活失败：{error}',
    imChannelActive: '{channel} 频道连接状态正常。',
    imChannelNoSessions: '{channel} 频道暂无活跃会话，Bot 可能未连接。',
    imChannelNoSessionsSuggestion: '请确认已正确扫码绑定，并检查 Bot 配置是否正确。',
    imChannelProbeError: '频道探活失败：{error}',
    emailSettings: '邮件设置',
    emailInstance: '邮箱账号',
    addEmailInstance: '添加邮箱账号',
    emailInstanceName: '账号名称',
    emailInstanceNamePlaceholder: '例如：工作邮箱',
    emailAddress: '邮箱地址',
    emailAddressPlaceholder: 'user@example.com',
    emailPassword: '密码',
    emailPasswordPlaceholder: '邮箱密码或应用专用密码',
    emailApiKey: 'API Key',
    emailApiKeyPlaceholder: 'ck_live_xxxxxxxx',
    getApiKey: '获取 API Key',
    apiKeyHint: '请从你的邮箱服务配置来源或管理员处获取 API Key，然后粘贴到此处。',
    emailTransportMode: '传输模式',
    emailTransportImap: 'IMAP/SMTP（传统模式）',
    emailTransportWs: 'WebSocket（安全模式，无需密码）',
    emailAllowFrom: '允许的发件人（白名单）',
    emailAllowFromPlaceholder: 'user@example.com\n*.trusted-domain.com\n*@company.com',
    emailAllowFromHint: '支持通配符，每行一个。留空表示接受所有发件人。',
    emailAdvancedOptions: '高级选项',
    emailImapSmtpConfig: 'IMAP/SMTP 服务器配置',
    emailImapHost: 'IMAP Host',
    emailImapPort: 'IMAP Port',
    emailSmtpHost: 'SMTP Host',
    emailSmtpPort: 'SMTP Port',
    emailServerConfigHint: '留空则自动根据邮箱域名推断',
    emailReplyStrategy: '回复策略',
    emailReplyMode: '回复模式',
    emailReplyModeImmediate: '立即发送（流式，每个块一封邮件）',
    emailReplyModeAccumulated: '累积发送（流式，缓冲后一封邮件）',
    emailReplyModeComplete: '完成后发送（等待完整回复）',
    emailReplyTo: '回复范围',
    emailReplyToSender: '仅回复发件人',
    emailReplyToAll: '回复发件人 + 所有收件人',
    emailA2aConfig: 'Agent-to-Agent 配置',
    emailA2aEnabled: '启用 A2A',
    emailA2aAgentDomains: 'Agent 域名',
    emailA2aAgentDomainsPlaceholder: 'agents.example.com',
    emailA2aAgentDomainsHint: '允许进行 Agent 协作的域名，每行一个',
    emailA2aMaxTurns: 'A2A最大往返次数',
    emailConnectivityFailAlert: '连通性测试失败，请检查配置',
    emailConnected: '已连接',
    emailDisconnected: '未连接',
    emailSaveSuccess: '配置已保存',
    emailSaveError: '保存失败',
    emailValidationError: '配置验证失败',
    emailMaxInstancesExceeded: '最多支持 {count} 个邮箱账号',
    emailDuplicateEmail: '邮箱地址「{email}」重复',
    emailDuplicateInstanceId: '实例 ID「{id}」重复',
    emailInvalidEmail: '邮箱地址格式不正确',
    emailMissingPassword: '实例「{name}」使用 IMAP 模式但未填写密码',
    emailMissingApiKey: '实例「{name}」使用 WebSocket 模式但未填写 API Key',
    emailInvalidApiKey: '实例「{name}」的 API Key 格式不正确（应以 ck_ 开头）',
    emailGatewayRestarting: '正在重启Agent 引擎 Gateway...',
    emailDeleteConfirm: '确定要删除邮箱账号「{name}」吗？',
    emailEnterValidEmailFirst: '请先填写有效的邮箱地址',
    emailVerifyInBrowserAndPaste: '请在浏览器中完成验证，然后将 API Key 粘贴回来',
    testConnection: '测试连接',
    emailTestSuccess: '连接测试成功！',
    emailTestFailed: '连接测试失败：{error}',

    // Community account authentication
    communityAuthLoginIncomplete: '登录未完成，请重试。',
    communityAuthServiceUnavailable: '登录服务暂时不可用，请稍后重试。',
    modelPoolLoginRequired: '请先登录知远账号后使用免费模型。',
    modelPoolQuotaExceeded: '今日免费模型额度已用完，请明日再试。',
    modelPoolServiceUnavailable: '免费模型服务暂时不可用，请稍后重试。',

    'enterprise.updateBlocked': '版本更新由企业统一管理',
  },
  en: {
    todoReminderTitle: 'Todo reminder',
    todoReminderBody: 'Due now: {title}',
    scheduledTaskDeliveryAccountMismatch:
      'The channel account does not match the selected conversation',
    // Tray menu
    trayShowWindow: 'Open 知远',
    trayNewTask: 'New Task',
    traySettings: 'Settings',
    trayQuit: 'Quit',

    // Session titles
    coworkDefaultSessionTitle: 'New Chat',
    codingAgentDefaultMissionTitle: 'New coding task',
    codingAgentSessionRecovery:
      'The previous agent session could not be restored. A handoff summary was sent to a new session.',
    codingAgentConfigModel: 'Model',
    codingAgentConfigThinkingLevel: 'Thinking level',
    codingAgentConfigPermissionMode: 'Permission mode',
    codingAgentPermissionModeAsk: 'Ask every time',
    codingAgentPermissionModeAuto: 'Auto-approve low risk',
    codingAgentPermissionModeAllowAll: 'Allow all',
    codingAgentNoAssistantResponse:
      'The external agent returned no assistant content. Check its sign-in state, model configuration, and network connection.',
    cronSessionPrefix: 'Cron',
    channelPrefixFeishu: 'Feishu',
    channelPrefixDingtalk: 'DingTalk',
    channelPrefixWecom: 'WeCom',
    channelPrefixWeixin: 'WeChat',
    channelPrefixEmail: 'Email',
    channelConversationTitle: '{channel} conversation · {id}',
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
    llamacppLaunchContextClampedToTrainingLimit:
      'The requested context {requested} exceeds the model training limit {trained}. Started with {effective} instead.',
    llamacppLoadModelLimitReached:
      'The model limit has been reached. Unload a model and try again.',
    llamacppLoadModelGpuNotFound:
      'No available GPU was detected. Check your GPU driver or CUDA environment and try again.',
    llamacppLoadModelGpuProbeFailed:
      'GPU environment detection failed. Check your GPU driver or CUDA environment and try again.',
    llamacppLoadModelVramInsufficient:
      'Insufficient VRAM. Check available VRAM or unload models and try again.',
    llamacppLoadModelSystemMemoryInsufficient:
      'Insufficient system memory. Close other applications and try again.',
    llamacppLoadModelContextTooLarge:
      'The model context is too large. The system lowered the configuration but still could not load it.',
    llamacppLoadModelFileInvalid: 'The model file is invalid. Download or import the model again.',
    llamacppLoadModelNotFound: 'The model file was not found. Download or import the model again.',
    llamacppLoadModelServiceUnavailable:
      'The local inference service is unavailable. Please try again later.',
    llamacppLoadModelStartupTimeout:
      'Model loading took too long. Try again later or lower the model configuration.',
    llamacppModelLoadCancelled: 'Model startup was cancelled.',
    llamacppLoadModelUnknown: 'Model loading failed. Please try again later.',
    llamacppModelLoadInProgress: 'A model is already loading. Wait for it to finish and try again.',
    llamacppServiceStartupPortInUse:
      'The local inference service port is already in use. Check the port setting or close the conflicting process and try again.',
    llamacppServiceStartupProcessExited:
      'The local inference service exited during startup. Please try again later.',
    llamacppServiceStartupTimeout:
      'The local inference service startup timed out. Please try again later.',
    llamacppServiceStartupBackendUnavailable:
      'The selected local inference runtime backend is unavailable. Check the GPU driver or runtime configuration.',
    llamacppServiceStartupRuntimeDamaged:
      'The local inference runtime is unavailable or may be damaged. Reinstall the application and try again.',
    llamacppServiceStartupUnknown:
      'The local inference service failed to start. Please try again later.',
    llamacppModelLaunchLogWindowTitle: 'Model startup logs',
    localInferenceImportRuntimeDialogTitle: 'Select local inference Backend',
    localInferenceImportRuntimeDialogMessage:
      'Select a local inference backend archive (zip or tar.gz). If it is already extracted, open that directory and choose any file inside it. ZhiYuan Agent will validate the platform and backend type before importing it.',
    coworkErrorUnknown:
      'Task failed due to an unexpected error. Please retry. If the issue persists, check your model configuration.',
    imErrorPrefix: 'Error processing message',
    // IM error replies (differentiated by error kind)
    imErrorAuthExpired:
      'AI assistant authentication expired. Please open the app to update your API key.',
    imErrorRateLimited: 'AI assistant is receiving too many requests. Please try again later.',
    imErrorBudgetExceeded:
      'AI assistant account balance insufficient. Please top up and try again.',
    imErrorEngineNotReady: 'AI engine is starting up. Please wait and try again.',
    imErrorTransient:
      'AI assistant temporarily unavailable ({error}). Automatically recovering, please try later.',
    imErrorContentFiltered:
      'Message content did not pass safety review. Please revise and try again.',
    imErrorInputTooLong: 'Message content too long. Please shorten and try again.',
    imErrorExecutionLimit: 'Task timed out or reached limit. Please simplify and try again.',
    imErrorUnknown: 'Error processing message: {error}. Please try again.',

    // Exec approval continuation
    execApprovalApproved:
      'The user approved the command execution. Please check the result and continue.',
    execApprovalDenied: 'The user denied the command execution.',

    // Skill manager errors
    skillErrNoSkillMd: 'No SKILL.md found in source',
    skillErrInvalidSource:
      'Invalid skill source. Use owner/repo, repo URL, npm package spec, a ModelScope skill URL, or a GitHub tree/blob URL.',
    skillErrModelScopeInstallUnavailable:
      'This ModelScope skill does not provide an installable source or archive. Check its ModelScope page for installation instructions.',
    skillErrAlreadyInstalled:
      'Skill {name} is already installed. Remove the existing version and try again.',

    // Gateway startup phases
    gatewayStartupPrecompiling: 'Pre-compiling gateway bundle...',
    gatewayStartupCompiling: 'Compiling gateway bundle...',
    gatewayStartupLoadingModules: 'Loading gateway modules...',
    gatewayStartupStarting: 'Starting AI engine...',

    // Auth quota
    authPlanFree: 'Free',
    authPlanStandard: 'Standard',

    // ── IM connectivity test messages ───────────────────────────────────
    // Common
    imMissingCredentials: 'Missing required configuration: {fields}',
    imFillCredentials: 'Please complete the configuration and test connectivity again.',
    imAuthProbeTimeout: 'Authentication probe timed out',
    imAuthFailed: 'Authentication failed: {error}',
    imAuthFailedSuggestion:
      'Please check that your ID/Secret/Token are correct and that bot permissions are enabled.',
    imWeixinReconnectRequired: 'Reconnect the Weixin channel before it can receive messages.',
    imChannelEnabledNotConnected: 'IM channel is enabled but not currently connected.',
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
    imNoInboundForOutboundCheck:
      'No inbound messages received yet to evaluate outbound capability.',
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
    imFeishuFillAppIdSecret:
      'Please provide the App ID and App Secret and test connectivity again.',
    imFeishuAuthPassed: 'Feishu authentication passed (Bot: {botName})',
    imFeishuAuthFailed: 'Feishu authentication failed: {error}',
    imFeishuCheckAppIdSecret: 'Please check that the App ID and App Secret are correct.',
    imFeishuGroupMention: 'Feishu only responds to @mentioned messages in group chats.',
    imFeishuGroupMentionSuggestion:
      'Please @mention the bot in group chats to start a conversation.',
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
    imWeixinGatewayNotRunning:
      'Agent engine Gateway is not running. WeChat channel cannot connect.',
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
    emailVerifyInBrowserAndPaste:
      'Please complete verification in browser, then paste API Key here',
    testConnection: 'Test Connection',
    emailTestSuccess: 'Connection test successful!',
    emailTestFailed: 'Connection test failed: {error}',

    // Community account authentication
    communityAuthLoginIncomplete: 'Login was not completed. Please try again.',
    communityAuthServiceUnavailable:
      'The login service is temporarily unavailable. Please try again later.',
    modelPoolLoginRequired: 'Sign in to your ZhiYuan account to use the free model.',
    modelPoolQuotaExceeded: 'Your free model quota is exhausted for today. Try again tomorrow.',
    modelPoolServiceUnavailable:
      'The free model service is temporarily unavailable. Please try again later.',

    'enterprise.updateBlocked': 'Updates are managed by enterprise',
  },
};

let currentLanguage: LanguageType = 'zh';

/** Set the active language. Call this when app_config.language changes. */
export function setLanguage(language: LanguageType): void {
  currentLanguage = language;
}

export function getLanguage(): LanguageType {
  return currentLanguage;
}

/**
 * Look up a translation key and optionally interpolate `{param}` placeholders.
 * Returns the key itself if no translation exists.
 *
 *   t('imMissingCredentials', { fields: 'appId, appSecret' })
 *   // => "缺少必要配置项: appId, appSecret"
 */
export function t(key: string, params?: Record<string, string | number>): string {
  let text =
    translations[currentLanguage][key] ??
    translations[currentLanguage === 'zh' ? 'en' : 'zh'][key] ??
    key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(`{${k}}`, String(v));
    }
  }
  return text;
}
