export const magpieTranslations = {
  zh: {
    magpieSubscriptionsOn: '订阅账号已启用',
    magpieSubscriptionsOff: '订阅账号已关闭',
    magpieSubscriptionsHint: '订阅账号由 Magpie 官方管理界面维护，凭据不会返回应用页面。',
    magpieSubscriptionsEnable: '启用订阅账号',
    magpieSubscriptionsDisable: '关闭订阅账号',
    magpieSubscriptionsEnableConsent:
      '启用后会发现并读取本机 Claude Code、Codex、Copilot 等现有登录及钥匙串，并允许支持的订阅登录。',
    magpieSubscriptionsDisableConsent:
      '关闭后停止发现和使用订阅账号，不删除本机登录文件或钥匙串记录。',
    magpieSubscriptionsRestartNotice:
      '更改需要重启模型服务，进行中的模型请求可能中断，已有任务记录保留。',
    magpieSubscriptionsConfirm: '确认并重启',
    magpiePrivacyWithAccounts:
      '已允许订阅账号发现与使用。遥测和局域网访问关闭。停止服务不会撤销已写入的 Agent 配置。',

    magpieCatalogTitle: '模型',
    magpieCatalogHint:
      '聊天、计划任务与 Coding 使用同一模型目录。Provider、凭据与路由在官方管理界面维护；本地 GPU 和企业模型由应用注册。订阅账号默认关闭。',
    magpieCatalogRefresh: '刷新目录',
    magpieDefaultModel: '默认模型',
    magpieCatalogEmpty: '目录暂无模型。请在管理界面配置 Provider，或启动本地模型后刷新。',
    magpieCatalogEnable: '启用模型服务',
    magpieCatalogConsent:
      '启用会启动 Magpie，并读取及自动同步已连接的本机 Agent 配置。订阅账号需单独启用，遥测与局域网访问关闭。',
    magpieSetDefault: '设为默认',

    magpieTitle: '本机 CLI 模型管理',
    magpieManagerDescription: '通过独立的 Magpie 管理本机 Agent 模型配置。',
    magpieActivationNotice:
      '启用后，Magpie 会读取并自动同步本机 Agent 配置。刷新管理状态也可能同步配置；选择模型后需点击“应用到 CLI”写入。',
    magpiePrivacyNotice:
      '默认不启动。自动订阅发现、遥测与局域网访问关闭。停止服务不会撤销已经写入的 Agent 配置。',
    magpieEnable: '启用本机 CLI 管理',
    magpieCheckStatus: '检查服务状态',
    magpieRefreshManagement: '刷新管理状态',
    magpieOpenManagement: '打开官方管理界面',
    magpieStop: '停止服务',
    magpieApplyModel: '应用到 CLI',
    magpieSelectModel: '选择模型',
    magpieApplyNotice:
      '应用会通过官方 Magpie 接口修改对应 Agent 的模型配置。请在该 Agent 中开启新会话以使用新配置。',
    magpieNotLoaded: '点击“刷新管理状态”读取本机 Agent；此操作可能同步配置。',
    magpieDiscoveryPending: '部分 CLI 版本仍在查询中，可稍后刷新。',
    magpieNoAgents: '尚未发现本机 Agent。这里不会自动安装 CLI。',
    magpieCliMissing: '未发现 CLI',
    magpieAgentDetected: '已发现',
    magpieVersionUnknown: '版本未知',
    magpieConfigured: '已配置网关',
    magpieModelUnset: '未设置',
    magpieNoModelField: '上游未提供可编辑的模型字段，请查看官方管理界面。',
    magpieUnavailable: '当前应用未提供模型管理接口。',
    magpieActionFailed: '模型管理操作未完成。请检查运行时是否可用，或稍后重试。',
    magpieState_stopped: '未启动',
    magpieState_starting: '启动中',
    magpieState_running: '运行中',
    magpieState_stopping: '停止中',
    magpieState_failed: '启动失败',
  },
  en: {
    magpieSubscriptionsOn: 'Subscription accounts enabled',
    magpieSubscriptionsOff: 'Subscription accounts disabled',
    magpieSubscriptionsHint:
      'Manage subscription accounts in the official Magpie UI. Credentials are not returned to this app page.',
    magpieSubscriptionsEnable: 'Enable subscription accounts',
    magpieSubscriptionsDisable: 'Disable subscription accounts',
    magpieSubscriptionsEnableConsent:
      'Enabling discovers and reads existing local Claude Code, Codex, Copilot and other supported sign-ins and keychain entries, and permits supported subscription sign-ins.',
    magpieSubscriptionsDisableConsent:
      'Disabling stops account discovery and use. Local sign-in files and keychain entries are not deleted.',
    magpieSubscriptionsRestartNotice:
      'This change restarts the model service and may interrupt active model requests. Existing task records are retained.',
    magpieSubscriptionsConfirm: 'Confirm and restart',
    magpiePrivacyWithAccounts:
      'Subscription account discovery and use are enabled. Telemetry and LAN access are disabled. Stopping does not undo Agent configuration already written.',

    magpieCatalogTitle: 'Models',
    magpieCatalogHint:
      'Chat, scheduled work and Coding share one model catalog. Manage providers, credentials and routing in the official management UI. Local GPU and enterprise models are registered by the app. Subscription accounts are off by default.',
    magpieCatalogRefresh: 'Refresh catalog',
    magpieDefaultModel: 'Default model',
    magpieCatalogEmpty:
      'No models in the catalog. Configure a provider in management, or start a local model and refresh.',
    magpieCatalogEnable: 'Enable model service',
    magpieCatalogConsent:
      'Enabling starts Magpie and reads and automatically synchronizes connected local Agent configuration. Subscription accounts require separate opt-in. Telemetry and LAN access are disabled.',
    magpieSetDefault: 'Set as default',

    magpieTitle: 'Local CLI model management',
    magpieManagerDescription:
      'Manage local Agent model configuration through the standalone Magpie runtime.',
    magpieActivationNotice:
      'Enabling Magpie reads and automatically synchronizes local Agent configuration. Refreshing management state may also synchronize configuration. A model selection made here is submitted when you click Apply to CLI.',
    magpiePrivacyNotice:
      'Off by default. Automatic subscription discovery, telemetry, and LAN access are disabled. Stopping does not undo Agent configuration already written.',
    magpieEnable: 'Enable local CLI management',
    magpieCheckStatus: 'Check service status',
    magpieRefreshManagement: 'Refresh management state',
    magpieOpenManagement: 'Open official management UI',
    magpieStop: 'Stop service',
    magpieApplyModel: 'Apply to CLI',
    magpieSelectModel: 'Choose a model',
    magpieApplyNotice:
      'Applying uses the official Magpie API to change this Agent’s model configuration. Start a new session in that Agent to use it.',
    magpieNotLoaded:
      'Refresh management state to read local Agents. This may synchronize configuration.',
    magpieDiscoveryPending: 'Some CLI versions are still being checked. Refresh again later.',
    magpieNoAgents: 'No local Agents detected. CLIs are not installed automatically.',
    magpieCliMissing: 'CLI not found',
    magpieAgentDetected: 'Detected',
    magpieVersionUnknown: 'Version unknown',
    magpieConfigured: 'Gateway configured',
    magpieModelUnset: 'Not set',
    magpieNoModelField:
      'Upstream provides no editable model field. Use its official management UI.',
    magpieUnavailable: 'Model management is unavailable in this application build.',
    magpieActionFailed:
      'Model management did not complete. Check runtime availability or try again later.',
    magpieState_stopped: 'Stopped',
    magpieState_starting: 'Starting',
    magpieState_running: 'Running',
    magpieState_stopping: 'Stopping',
    magpieState_failed: 'Failed',
  },
};
