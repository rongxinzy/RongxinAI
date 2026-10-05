import { DestructiveConfirmDialog } from '@shared/components/ui/destructive-confirm-dialog';
import { useCallback, useMemo, useRef } from 'react';

import { ProviderName } from '../../../../shared/providers';
import { i18nService, type LanguageType } from '../../../services/i18n';
import {
  ProviderModelEditorDialog,
  type ProviderModelEditorDraft,
} from '../ProviderModelEditorDialog';
import type { ProviderModelRowActions } from '../ProviderModelRow';
import { useModelConnectionStatus } from '../useModelConnectionStatus';
import type { ProvidersConfig, ProviderType } from './constants';
import ProviderConfigColumn from './ProviderConfigColumn';
import ProviderListColumn from './ProviderListColumn';
import { useConnectionTest } from './useConnectionTest';
import { useModelEditor } from './useModelEditor';
import { useProviderImportExport } from './useProviderImportExport';
import { useProviderOAuth } from './useProviderOAuth';
import { useProvidersController } from './useProvidersController';

export interface ModelSettingsSaveSnapshot {
  providers: ProvidersConfig;
  activeProvider: ProviderType;
}

export interface ModelSettingsHandle {
  getSaveSnapshot: () => ModelSettingsSaveSnapshot;
  resetModelEditorOnProviderSwitch: () => void;
}

interface ModelSettingsPanelProps {
  initialProvider?: ProviderType;
  language: LanguageType;
  /** Filled every render so the settings shell can read the latest model domain state. */
  handleRef: React.MutableRefObject<ModelSettingsHandle | null>;
  setError: (message: string | null) => void;
  setNoticeMessage: (message: string | null) => void;
}

export default function ModelSettingsPanel({
  initialProvider,
  language,
  handleRef,
  setError,
  setNoticeMessage,
}: ModelSettingsPanelProps) {
  const {
    getModelConnectionStatus,
    mergeProviderModelConnectionStatuses,
    resetProviderModelConnectionStatuses,
    setModelConnectionStatus,
    setProviderModelConnectionStatuses,
  } = useModelConnectionStatus();
  const modelConnectionTestRequestIdRef = useRef<Partial<Record<ProviderType, number>>>({});

  const invalidateProviderModelConnectionStatuses = useCallback(
    (provider: ProviderType) => {
      modelConnectionTestRequestIdRef.current[provider] =
        (modelConnectionTestRequestIdRef.current[provider] ?? 0) + 1;
      resetProviderModelConnectionStatuses(provider);
    },
    [resetProviderModelConnectionStatuses],
  );

  const requestCopilotSignInRef = useRef<() => void>(() => undefined);

  const controller = useProvidersController({
    initialProvider,
    language,
    setError,
    invalidateProviderModelConnectionStatuses,
    requestCopilotSignInRef,
  });
  const { providers, setProviders, activeProvider } = controller;

  const oauth = useProviderOAuth({
    providers,
    setProviders,
    activeProvider,
    handleProviderConfigChange: controller.handleProviderConfigChange,
    enableProvider: controller.enableProvider,
    setError,
  });
  requestCopilotSignInRef.current = oauth.handleCopilotSignIn;

  const connectionTest = useConnectionTest({
    providers,
    setProviders,
    activeProvider,
    selectedModelId: controller.selectedModelId,
    setSelectedModelId: controller.setSelectedModelId,
    enableProvider: controller.enableProvider,
    modelConnectionTestRequestIdRef,
    mergeProviderModelConnectionStatuses,
    setModelConnectionStatus,
    setProviderModelConnectionStatuses,
  });

  const editor = useModelEditor({ providers, setProviders, activeProvider });

  const importExport = useProviderImportExport({
    providers,
    setProviders,
    setError,
    setNoticeMessage,
  });

  // 模型行是 memo 组件：整棵设置面板每次状态更新都会重渲染，所以行回调的引用必须稳定，
  // 否则每次更新都会重渲染整张模型列表（几百个模型时明显卡顿）。
  // 用 ref 指向最新的处理函数，避免为了稳定引用把 providers 之类的状态塞进 useCallback 依赖。
  const modelRowActionsRef = useRef<ProviderModelRowActions | null>(null);
  const modelRowActions = useMemo<ProviderModelRowActions>(
    () => ({
      testModel: model => modelRowActionsRef.current?.testModel(model),
      editModel: model => modelRowActionsRef.current?.editModel(model),
      deleteModel: model => modelRowActionsRef.current?.deleteModel(model),
    }),
    [],
  );
  // 每帧读取最新实现：行组件拿到的引用因此可以永久稳定。
  modelRowActionsRef.current = {
    testModel: connectionTest.handleRowModelTest,
    editModel: editor.handleRowModelEdit,
    deleteModel: editor.handleRowModelDelete,
  };

  handleRef.current = {
    getSaveSnapshot: () => ({ providers, activeProvider }),
    resetModelEditorOnProviderSwitch: editor.resetModelEditorOnProviderSwitch,
  };

  const handleProviderChange = (provider: ProviderType) => {
    editor.resetModelEditorOnProviderSwitch();
    controller.handleProviderChange(provider);
  };

  const handleAddCustomProvider = () => {
    controller.handleAddCustomProvider();
    editor.resetModelEditorOnCustomProviderAdd();
  };

  // authType defaults to undefined on first open, which should behave as OAuth mode
  const minimaxIsOAuthMode = providers.minimax.authType !== 'apikey';
  // OpenAI defaults to API key mode unless the user explicitly opts in to OAuth
  const openaiIsOAuthMode = providers.openai.authType === 'oauth';
  const isBaseUrlLocked =
    (activeProvider === 'zhipu' && providers.zhipu.codingPlanEnabled) ||
    (activeProvider === 'qwen' && providers.qwen.codingPlanEnabled) ||
    (activeProvider === 'volcengine' && providers.volcengine.codingPlanEnabled) ||
    (activeProvider === 'moonshot' && providers.moonshot.codingPlanEnabled) ||
    (activeProvider === 'qianfan' && providers.qianfan.codingPlanEnabled) ||
    (activeProvider === 'xiaomi' && providers.xiaomi.codingPlanEnabled) ||
    (activeProvider === 'minimax' && minimaxIsOAuthMode) ||
    (activeProvider === 'openai' && openaiIsOAuthMode) ||
    activeProvider === ProviderName.LlamaCpp;

  return (
    <>
      <div className="flex h-full flex-col md:flex-row">
        <ProviderListColumn
          visibleProviders={controller.visibleProviders}
          providers={providers}
          activeProvider={activeProvider}
          isImportingProviders={importExport.isImportingProviders}
          isExportingProviders={importExport.isExportingProviders}
          importInputRef={importExport.importInputRef}
          onImportClick={importExport.handleImportProvidersClick}
          onImportFile={importExport.handleImportProviders}
          onExport={importExport.handleExportProviders}
          onProviderChange={handleProviderChange}
          onAddCustomProvider={handleAddCustomProvider}
          onDeleteCustomProvider={controller.handleDeleteCustomProvider}
          onToggleProviderEnabled={controller.toggleProviderEnabled}
        />
        <ProviderConfigColumn
          providers={providers}
          setProviders={setProviders}
          activeProvider={activeProvider}
          showApiKey={controller.showApiKey}
          setShowApiKey={controller.setShowApiKey}
          minimaxIsOAuthMode={minimaxIsOAuthMode}
          openaiIsOAuthMode={openaiIsOAuthMode}
          isBaseUrlLocked={isBaseUrlLocked}
          minimaxOAuthPhase={oauth.minimaxOAuthPhase}
          setMinimaxOAuthPhase={oauth.setMinimaxOAuthPhase}
          minimaxOAuthRegion={oauth.minimaxOAuthRegion}
          setMinimaxOAuthRegion={oauth.setMinimaxOAuthRegion}
          onMiniMaxDeviceLogin={oauth.handleMiniMaxDeviceLogin}
          onCancelMiniMaxLogin={oauth.handleCancelMiniMaxLogin}
          onMiniMaxOAuthLogout={oauth.handleMiniMaxOAuthLogout}
          openaiOAuthPhase={oauth.openaiOAuthPhase}
          setOpenaiOAuthPhase={oauth.setOpenaiOAuthPhase}
          openaiOAuthStatus={oauth.openaiOAuthStatus}
          onOpenAIOAuthLogin={oauth.handleOpenAIOAuthLogin}
          onCancelOpenAIOAuthLogin={oauth.handleCancelOpenAIOAuthLogin}
          onOpenAIOAuthLogout={oauth.handleOpenAIOAuthLogout}
          copilotAuthStatus={oauth.copilotAuthStatus}
          copilotUserCode={oauth.copilotUserCode}
          copilotVerificationUri={oauth.copilotVerificationUri}
          copilotGithubUser={oauth.copilotGithubUser}
          copilotError={oauth.copilotError}
          onCopilotSignIn={oauth.handleCopilotSignIn}
          onCopilotSignOut={oauth.handleCopilotSignOut}
          onCopilotCancelAuth={oauth.handleCopilotCancelAuth}
          autoDetectRequest={controller.autoDetectRequest}
          isRefreshingLlamaCppModels={controller.isRefreshingLlamaCppModels}
          onRefreshLlamaCppModels={controller.handleRefreshLlamaCppModels}
          onProviderConfigChange={controller.handleProviderConfigChange}
          onApiKeyInputChange={controller.handleApiKeyInputChange}
          onBaseUrlInputChange={controller.handleBaseUrlInputChange}
          onApiKeyBlur={controller.handleApiKeyBlur}
          onBaseUrlBlur={controller.handleBaseUrlBlur}
          onRequestApiKeyClear={controller.requestApiKeyClear}
          onModelsDiscovered={connectionTest.handleModelsDiscovered}
          onAddModel={editor.handleAddModel}
          getModelConnectionStatus={getModelConnectionStatus}
          modelRowActions={modelRowActions}
        />
      </div>

      <DestructiveConfirmDialog
        open={controller.pendingDeleteProvider !== null}
        title={i18nService.t('deleteCustomProvider')}
        description={i18nService.t('confirmDeleteCustomProvider')}
        cancelLabel={i18nService.t('cancel')}
        confirmLabel={i18nService.t('deleteCustomProvider')}
        onCancel={() => controller.setPendingDeleteProvider(null)}
        onConfirm={controller.confirmDeleteCustomProvider}
      />

      <DestructiveConfirmDialog
        open={controller.pendingApiKeyClearProvider !== null}
        title={i18nService.t('clearApiKeyConfirmTitle')}
        description={i18nService.t('clearApiKeyConfirmDescription')}
        cancelLabel={i18nService.t('cancel')}
        confirmLabel={i18nService.t('clear')}
        confirmVariant="outline"
        onCancel={() => controller.setPendingApiKeyClearProvider(null)}
        onConfirm={controller.confirmApiKeyClear}
      />

      <DestructiveConfirmDialog
        open={editor.pendingDeleteModel !== null}
        title={i18nService.t('confirmDelete')}
        description={
          editor.pendingDeleteModel
            ? `${i18nService.t('delete')} "${editor.pendingDeleteModel.name}"?`
            : ''
        }
        cancelLabel={i18nService.t('cancel')}
        confirmLabel={i18nService.t('delete')}
        confirmVariant="outline"
        onCancel={() => editor.setPendingDeleteModel(null)}
        onConfirm={editor.confirmDeleteModel}
      />

      <ProviderModelEditorDialog
        isOpen={editor.isAddingModel || editor.isEditingModel}
        isEditing={editor.isEditingModel}
        providerName={activeProvider}
        draft={
          {
            id: editor.newModelId,
            name: editor.newModelName,
            contextWindow: editor.newModelContextWindow,
            maxTokens: editor.newModelMaxTokens,
            capabilities: editor.newModelCapabilities,
            piRuntime: editor.newModelPiRuntime,
          } satisfies ProviderModelEditorDraft
        }
        error={editor.modelFormError}
        onDraftChange={editor.handleModelEditorDraftChange}
        onClose={editor.handleCancelModelEdit}
        onSave={editor.handleSaveNewModel}
      />
    </>
  );
}
