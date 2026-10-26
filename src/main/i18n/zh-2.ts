export const zhMain2 = {
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
  llamacppCudaBackendFallbackCpu:
    'CUDA 后端安装或校验失败，已自动改用 CPU 版 llama.cpp 运行时。可在「本地推理 → 运行时」中手动选择 CUDA 后端。',
  llamacppCudaBackendFallbackCpuDriver:
    '检测到 NVIDIA 驱动与所选 CUDA 运行时可能不兼容，已自动改用 CPU 版 llama.cpp 运行时。请升级驱动或切换 CUDA 12/13 后端后重试。',
  llamacppCudaEditionUnsupportedGpu:
    '当前 GPU 计算能力为 {capability}，CUDA 版仅支持 {required}（RTX 40 系列）。请安装 CPU 版知远智能体，或更换兼容显卡。',
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
  imErrorModelCapabilityUnsupported:
    '当前模型不支持该输入模态（如图像），请更换模型或检查模型配置后重试。',
  imErrorProviderUnavailable:
    '当前会话使用的模型服务已停用或不可用，请检查应用内的模型配置后重试。',
  imErrorStreamInterrupted: '与模型的连接中断，本次任务已停止。请重新发送消息。',
  imErrorUnknown: '处理消息时遇到错误: {error}。请稍后重试。',

  // Image input fallback (see libs/agentEngine/piImageInputFallback.ts)
  coworkImageNotSentNotice:
    '本条消息包含图片，但图片未发送给模型。已把图片文件路径交给模型，它会尝试用本机工具读取其中的文字。若该模型支持图片输入，可在模型设置中开启。',
  coworkImageRetryNotice: '该模型拒绝了图片输入，已自动改为纯文本重试本次请求。',

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
};
