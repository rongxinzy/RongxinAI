export const externalAgentsCopy = {
  zh: {
    magpieManagerDescription: '通过独立的模型服务管理本机 Agent 模型配置。',
    magpieExternalKeepRunningNotice: '外部 Agent 需要知远保持运行，退出应用后网关将不可用。',
    magpieExternalServiceRequired: '请先在「服务」中启用模型服务，然后刷新本页读取 Agent 状态。',
    magpieExternalDisconnectAll: '全部断开',
    magpieExternalDisconnectAllTitle: '断开全部外部 Agent？',
    magpieExternalDisconnectAllDescription:
      '将恢复所有已接入 Agent 的原始配置文件；未接入的 Agent 不受影响。',
    magpieExternalDisconnectOnQuit: '退出时断开所有外部 Agent',
    magpieExternalDisconnectOnQuitHint: '关闭应用前恢复各 Agent 的原始配置文件。默认关闭。',
    magpieExternalStatusMissing: '未安装',
    magpieExternalStatusDisconnected: '未接入',
    magpieExternalStatusConnected: '已接入',
    magpieExternalStatusConnectedDetail: '{count} 个模型',
    magpieExternalStatusConnectedDetailOne: '1 个模型',
    magpieExternalVersion: '版本 {version}',
    magpieExternalToggleLabel: '切换 {name} 接入状态',
    magpieExternalConnectConfirmTitle: '确认接入外部 Agent',
    magpieExternalDisconnectConfirmTitle: '确认断开外部 Agent',
    magpieExternalConnectConfirmAction: '接入',
    magpieExternalDisconnectConfirmAction: '断开',
    magpieExternalCancel: '取消',
    magpieExternalReapplyError: '网关漂移',
    magpieExternalGatewayTarget: '网关地址：{url}',
    magpieExternalSettingsLink: '接入外部 Agent',
    magpieExternalSettingsLinkHint: '让本机 CLI 使用知远已配置的模型。',
    magpieExternalAgentClaude: 'Claude Code',
    magpieExternalAgentOpenCode: 'OpenCode',
    magpieExternalAgentGemini: 'Gemini CLI',
    magpieExternalAgentCodex: 'Codex',
    magpieExternalConnectHintClaude:
      '将修改 ~/.claude/settings.json 中的 ANTHROPIC_BASE_URL 等环境变量，并写入知远网关模型。',
    magpieExternalConnectHintOpenCode:
      '将修改 OpenCode 配置中的 provider 与模型项，使其经知远网关转发请求。',
    magpieExternalConnectHintGemini:
      '将修改 Gemini CLI 配置中的模型与端点，使其经知远网关转发请求。',
    magpieExternalConnectHintPi:
      '将修改 ~/.pi/agent 下的 settings.json 等文件，使其经知远网关转发请求。',
    magpieExternalConnectHintCodex:
      '将修改 ~/.codex/config.toml 中的 model 等字段，使其经知远网关转发请求（不启用 ChatGPT 订阅接入）。',
    magpieActivationNotice:
      '启用后，模型服务会读取并自动同步本机 Agent 配置。刷新管理状态也可能同步配置；选择模型后需点击“应用到 CLI”写入。',
    magpiePrivacyNotice:
      '默认不启动。自动订阅发现、遥测与局域网访问关闭。停止服务不会撤销已经写入的 Agent 配置。',
    magpieEnable: '启用本机 CLI 管理',
    magpieCheckStatus: '检查服务状态',
    magpieRefreshManagement: '刷新管理状态',
    magpieStop: '停止服务',
    magpieApplyModel: '应用到 CLI',
    magpieSelectModel: '选择模型',
    magpieApplyNotice:
      '应用会通过模型服务修改对应 Agent 的模型配置。请在该 Agent 中开启新会话以使用新配置。',
    magpieNotLoaded: '点击“刷新管理状态”读取本机 Agent；此操作可能同步配置。',
    magpieDiscoveryPending: '部分 CLI 版本仍在查询中，可稍后刷新。',
    magpieNoAgents: '尚未发现本机 Agent。这里不会自动安装 CLI。',
    magpieCliMissing: '未发现 CLI',
    magpieAgentDetected: '已发现',
    magpieVersionUnknown: '版本未知',
    magpieConfigured: '已配置网关',
    magpieNoModelField: '上游未提供可编辑的模型字段，请在对应 Agent 中修改。',
    magpieUnavailable: '当前应用未提供模型管理接口。',
    magpieDirectMode: '直连独立模式',
    magpieWiredGateway: '已接入统一网关',
    magpieModelConfigTitle: '本地模型配置',
    magpieWireConfirmTitle: '接入统一网关确认',
    magpieWireConfirmDesc:
      '此操作将配置该 Agent 的 CLI 使用知远统一网关分发模型请求。原有本机凭据不会被删除，随时可恢复。',
    magpieWireTargetAgent: '目标 Agent',
    magpieWireTargetModel: '生效模型',
    magpieProbeGuideNoModel: '该 Agent 尚未配置生效模型，请在下方选择模型后点击应用。',
  },
  en: {
    magpieManagerDescription:
      'Manage local Agent model configuration through the standalone model service.',
    magpieExternalKeepRunningNotice:
      'External Agents require ZhiYuan to keep running. The gateway is unavailable after you quit the app.',
    magpieExternalServiceRequired:
      'Enable the model service in Service first, then refresh this page to read Agent status.',
    magpieExternalDisconnectAll: 'Disconnect all',
    magpieExternalDisconnectAllTitle: 'Disconnect all external Agents?',
    magpieExternalDisconnectAllDescription:
      'Restores the original configuration files of every connected Agent. Agents that are not connected are unchanged.',
    magpieExternalDisconnectOnQuit: 'Disconnect all external Agents on quit',
    magpieExternalDisconnectOnQuitHint:
      'Restore each Agent’s original configuration files before the app exits. Off by default.',
    magpieExternalStatusMissing: 'Not installed',
    magpieExternalStatusDisconnected: 'Not connected',
    magpieExternalStatusConnected: 'Connected',
    magpieExternalStatusConnectedDetail: '{count} models',
    magpieExternalStatusConnectedDetailOne: '1 model',
    magpieExternalVersion: 'Version {version}',
    magpieExternalToggleLabel: 'Toggle {name} connection',
    magpieExternalConnectConfirmTitle: 'Connect external Agent',
    magpieExternalDisconnectConfirmTitle: 'Disconnect external Agent',
    magpieExternalConnectConfirmAction: 'Connect',
    magpieExternalDisconnectConfirmAction: 'Disconnect',
    magpieExternalCancel: 'Cancel',
    magpieExternalReapplyError: 'Gateway drift',
    magpieExternalGatewayTarget: 'Gateway: {url}',
    magpieExternalSettingsLink: 'Connect external Agents',
    magpieExternalSettingsLinkHint: 'Route local CLIs through models configured in ZhiYuan.',
    magpieExternalAgentClaude: 'Claude Code',
    magpieExternalAgentOpenCode: 'OpenCode',
    magpieExternalAgentGemini: 'Gemini CLI',
    magpieExternalAgentCodex: 'Codex',
    magpieExternalConnectHintClaude:
      'Updates ANTHROPIC_BASE_URL and related keys in ~/.claude/settings.json and selects a gateway model.',
    magpieExternalConnectHintOpenCode:
      'Updates OpenCode provider and model entries to route requests through the gateway.',
    magpieExternalConnectHintGemini:
      'Updates Gemini CLI model and endpoint settings to route requests through the gateway.',
    magpieExternalConnectHintPi:
      'Updates ~/.pi/agent settings to route requests through the gateway.',
    magpieExternalConnectHintCodex:
      'Updates model fields in ~/.codex/config.toml to route through the gateway (ChatGPT subscription join stays disabled).',
    magpieActivationNotice:
      'Enabling the model service reads and automatically synchronizes local Agent configuration. Refreshing management state may also synchronize configuration. A model selection made here is submitted when you click Apply to CLI.',
    magpiePrivacyNotice:
      'Off by default. Automatic subscription discovery, telemetry, and LAN access are disabled. Stopping does not undo Agent configuration already written.',
    magpieEnable: 'Enable local CLI management',
    magpieCheckStatus: 'Check service status',
    magpieRefreshManagement: 'Refresh management state',
    magpieStop: 'Stop service',
    magpieApplyModel: 'Apply to CLI',
    magpieSelectModel: 'Choose a model',
    magpieApplyNotice:
      'Applying uses the model service to change this Agent’s model configuration. Start a new session in that Agent to use it.',
    magpieNotLoaded:
      'Refresh management state to read local Agents. This may synchronize configuration.',
    magpieDiscoveryPending: 'Some CLI versions are still being checked. Refresh again later.',
    magpieNoAgents: 'No local Agents detected. CLIs are not installed automatically.',
    magpieCliMissing: 'CLI not found',
    magpieAgentDetected: 'Detected',
    magpieVersionUnknown: 'Version unknown',
    magpieConfigured: 'Gateway configured',
    magpieNoModelField: 'Upstream exposes no editable model field; edit it in that Agent.',
    magpieUnavailable: 'Model management is unavailable in this application build.',
    magpieDirectMode: 'Direct Standalone',
    magpieWiredGateway: 'Wired to Gateway',
    magpieModelConfigTitle: 'Local Model Configuration',
    magpieWireConfirmTitle: 'Confirm Gateway Configuration',
    magpieWireConfirmDesc:
      'This will configure the agent CLI to route model requests through the unified gateway. Existing credentials are not deleted and can be reverted at any time.',
    magpieWireTargetAgent: 'Target Agent',
    magpieWireTargetModel: 'Target Model',
    magpieProbeGuideNoModel:
      'No model is currently configured for this agent. Select a model below and click Apply.',
  },
};
