import { recipe } from './recipe';
/** Shared size compositions; call-site origins are recorded for review. */
export function classicControlSizing() {
  return {
    'control-content-height': recipe({ base: { height: 'auto' } }),
    'composition-card-footer': recipe({ base: { 'padding-bottom': '0px' } }),
    'composition-card-image': recipe({ base: { 'padding-top': '0px' } }),
    'composition-card-header-border': recipe({ base: { 'padding-bottom': '1rem' } }),
    'composition-button-icon': recipe({ base: { width: '1rem', height: '1rem' } }),
    'composition-button-icon-xs': recipe({ base: { width: '0.75rem', height: '0.75rem' } }),
    'composition-button-icon-sm': recipe({ base: { width: '0.875rem', height: '0.875rem' } }),
    'composition-button-leading': recipe({ base: { 'padding-left': '0.5rem' } }),
    'composition-button-trailing': recipe({ base: { 'padding-right': '0.5rem' } }),
    'composition-button-small-leading': recipe({ base: { 'padding-left': '0.375rem' } }),
    'composition-button-small-trailing': recipe({ base: { 'padding-right': '0.375rem' } }),
    'composition-model-outline': recipe({
      base: {
        'border-style': 'none',
        'outline-style': 'solid',
        'outline-width': '1px',
        'outline-color': 'var(--border)',
      },
    }),
    'composition-market-footer': recipe({ base: { 'padding-bottom': '1rem' } }),
    // src/renderer/components/ModelSelector.tsx:99, src/renderer/components/skills/SkillsPopover.tsx:120
    'control-sizing-1': recipe({
      base: { 'padding-inline': '0.75rem', 'padding-block': '0.625rem' },
    }),
    // src/renderer/components/ModelSelector.tsx:134, src/renderer/components/coding/CodingGitPanel.tsx:322, src/renderer/components/coding/CodingGitPanel.tsx:426, src/renderer/components/cowork/SessionExpertPicker.tsx:99
    'control-sizing-2': recipe({
      base: { 'padding-inline': '0.75rem', 'padding-block': '0.5rem' },
    }),
    // src/renderer/components/Settings.tsx:3428, src/renderer/components/Settings.tsx:3863, src/renderer/components/Settings.tsx:3945
    'control-sizing-3': recipe({ base: { 'padding-right': '5rem' } }),
    // src/renderer/components/coding/CodingAgentManager.tsx:121, src/renderer/components/coding/CodingAgentPicker.tsx:82, src/renderer/components/coding/CodingWorkbenchView.tsx:888, src/renderer/components/coding/CodingWorkbenchView.tsx:933, src/renderer/components/expert/ExpertDetailDialog.tsx:55, src/renderer/components/im/DingTalkInstanceSettings.tsx:232, src/renderer/components/im/DiscordInstanceSettings.tsx:127, src/renderer/components/im/FeishuInstanceSettings.tsx:137, src/renderer/components/im/QQInstanceSettings.tsx:107, src/renderer/components/im/TelegramInstanceSettings.tsx:110, src/renderer/components/im/WecomInstanceSettings.tsx:117, src/renderer/components/mcp/McpOfficialConnectDialog.tsx:74, src/renderer/components/scheduledTasks/ScheduledTasksView.tsx:210, src/renderer/components/scheduledTasks/ScheduledTasksView.tsx:237, src/renderer/components/scheduledTasks/TaskList.tsx:48, src/renderer/components/settings/memory/MemoryRecordList.tsx:352, src/renderer/components/skills/MarketplaceSkillDocumentDialog.tsx:128, src/shared/components/ai-elements/context.tsx:153, src/shared/components/ai-elements/model-selector.tsx:38
    'control-sizing-4': recipe({ base: { padding: '0rem' } }),
    // src/renderer/components/coding/CodingAgentManager.tsx:271, src/renderer/components/scheduledTasks/TaskFormBody.tsx:244
    'control-sizing-5': recipe({ base: { 'min-height': '5rem' } }),
    // src/renderer/components/coding/CodingGitPanel.tsx:295, src/renderer/components/coding/CodingGitPanel.tsx:304, src/renderer/components/coding/CodingGitPanel.tsx:398, src/renderer/components/coding/CodingGitPanel.tsx:406, src/renderer/components/localInference/components/RuntimeInstallCard.tsx:255, src/renderer/components/localInference/components/RuntimeInstallCard.tsx:325
    'control-sizing-6': recipe({ base: { 'padding-inline': '0rem' } }),
    // src/renderer/components/coding/CodingGitPanel.tsx:534, src/renderer/components/coding/CodingTaskList.tsx:29
    'control-sizing-7': recipe({ base: { 'padding-inline': '0.5rem', 'padding-block': '0.5rem' } }),
    // src/renderer/components/coding/CodingWorkbenchView.tsx:1032
    'control-sizing-8': recipe({ base: { height: '1.5rem', 'padding-inline': '0.5rem' } }),
    // src/renderer/components/coding/CodingWorkspaceDialog.tsx:171, src/renderer/components/cowork/TodoQueue.tsx:103
    'control-sizing-9': recipe({ base: { 'padding-inline': '0.75rem' } }),
    // src/renderer/components/cowork/ContextUsageIndicator.tsx:121, src/renderer/components/localInference/panels/ModelsPanel.tsx:606, src/renderer/components/scheduledTasks/DateInput.tsx:157
    'control-sizing-10': recipe({ base: { padding: '0.75rem' } }),
    // src/renderer/components/cowork/CoworkQuestionWizard.tsx:353
    'control-sizing-11': recipe({ base: { 'padding-inline': '1rem', 'padding-block': '0.75rem' } }),
    // src/renderer/components/cowork/CoworkSessionDetail.tsx:1395
    'control-sizing-12': recipe({ base: { 'padding-inline': '0rem', 'padding-block': '5px' } }),
    // src/renderer/components/cowork/EmbeddingSettingsSection.tsx:64
    'control-sizing-13': recipe({ base: { 'padding-top': '1rem' } }),
    // src/renderer/components/cowork/PendingMessageQueue.tsx:173
    'control-sizing-14': recipe({ base: { height: '2rem' } }),
    // src/renderer/components/cowork/PromptPlusMenu.tsx:306
    'control-sizing-15': recipe({
      base: { 'padding-block': '0.5rem', 'padding-right': '2rem', 'padding-left': '0.5rem' },
    }),
    // src/renderer/components/cowork/PromptPlusMenu.tsx:334
    'control-sizing-16': recipe({ base: { 'padding-block': '0.625rem' } }),
    // src/renderer/components/im/IMSettings.tsx:1203, src/shared/components/ai-elements/attachments.tsx:381
    'control-sizing-17': recipe({ base: { padding: '0.5rem' } }),
    // src/renderer/components/localInference/LocalInferenceView.tsx:1315
    'control-sizing-18': recipe({ base: { 'padding-top': '0rem' } }),
    // src/renderer/components/localInference/LocalInferenceView.tsx:1341, src/renderer/components/localInference/components/LocalInferenceAccessSettingsDialog.tsx:67, src/renderer/components/localInference/components/LocalInferenceMemorySettingsDialog.tsx:62, src/renderer/components/localInference/components/ModelLibrarySettingsModal.tsx:44, src/renderer/components/mcp/McpServerFormModal.tsx:292, src/renderer/components/settings/memory/MemoryRecordList.tsx:545
    'control-sizing-19': recipe({ base: { 'padding-right': '2rem' } }),
    // src/renderer/components/localInference/components/MarketplaceCardLayout.tsx:23, src/shared/components/ai-elements/prompt-input.tsx:983
    'control-sizing-20': recipe({ base: { 'min-height': '4rem' } }),
    // src/renderer/components/localInference/components/MarketplaceModelDetails.tsx:68, src/renderer/components/localInference/panels/ModelsPanel.tsx:533
    'control-sizing-21': recipe({ base: { padding: '1rem' } }),
    // src/renderer/components/localInference/components/ModelContextSettingsModal.tsx:102
    'control-sizing-22': recipe({ base: { height: '1.75rem' } }),
    // src/renderer/components/localInference/panels/MarketplacePanel.tsx:221
    'control-sizing-23': recipe({ base: { height: '2.25rem' } }),
    // src/renderer/components/localInference/panels/ModelsPanel.tsx:398
    'control-sizing-24': recipe({ base: { height: '2.25rem', 'padding-inline': '1rem' } }),
    // src/renderer/components/mcp/McpOfficialConnectDialog.tsx:77
    'control-sizing-25': recipe({
      base: { 'padding-inline': '1rem', 'padding-top': '1.5rem', 'padding-bottom': '1rem' },
    }),
    // src/renderer/components/mcp/McpTokenConnectDialog.tsx:67
    'control-sizing-26': recipe({ base: { 'padding-right': '2.5rem' } }),
    // src/renderer/components/scheduledTasks/AllRunsHistory.tsx:270
    'control-sizing-27': recipe({ base: { 'padding-block': '0.75rem' } }),
    // src/renderer/components/settings/memory/ManagedMemorySettings.tsx:339
    'control-sizing-28': recipe({ base: { height: '24rem' } }),
    // src/renderer/components/settings/memory/ManagedMemorySettings.tsx:358
    'control-sizing-29': recipe({ base: { height: '20rem' } }),
    // src/renderer/components/todo/TodoView.tsx:311
    'control-sizing-30': recipe({ base: { 'padding-left': '2rem' } }),
    // src/shared/components/ai-elements/model-selector.tsx:56
    'control-sizing-31': recipe({ base: { 'padding-block': '0.875rem' } }),
    // src/shared/components/ui/input-group.tsx:126
    'control-sizing-32': recipe({ base: { 'padding-block': '0.5rem' } }),
  };
}
