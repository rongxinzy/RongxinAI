import { useState } from 'react';

import {
  ModelCapabilityStatus,
  ProviderModelOrigin,
  ProviderName,
  ProviderRegistry,
  type ModelCapabilities,
  type ProviderModelPiRuntimeConfig,
} from '../../../../shared/providers';
import { isCustomProvider } from '../../../config';
import { LLAMACPP_RUNNING_MODELS_CHANGED_EVENT } from '../../../services/availableModels';
import { i18nService } from '../../../services/i18n';
import { resolveOllamaModelEditorContext } from '../providerModelEditorContext';
import type { ProviderModelEntry } from '../ProviderModelRow';
import { formatTokenK } from '../tokenFormat';
import {
  DEFAULT_CUSTOM_MODEL_CAPABILITIES,
  type ProvidersConfig,
  type ProviderType,
} from './constants';
import { getEffectiveApiFormat, parseTokenK, resolveBaseUrl } from './providerUtils';

interface UseModelEditorParams {
  providers: ProvidersConfig;
  setProviders: React.Dispatch<React.SetStateAction<ProvidersConfig>>;
  activeProvider: ProviderType;
}

export function useModelEditor({ providers, setProviders, activeProvider }: UseModelEditorParams) {
  // State for model editing
  const [isAddingModel, setIsAddingModel] = useState(false);
  const [isEditingModel, setIsEditingModel] = useState(false);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [newModelName, setNewModelName] = useState('');
  const [newModelId, setNewModelId] = useState('');
  const [newModelContextWindow, setNewModelContextWindow] = useState('');
  const [newModelMaxTokens, setNewModelMaxTokens] = useState('');
  const [newModelCapabilities, setNewModelCapabilities] = useState<Partial<ModelCapabilities>>(
    DEFAULT_CUSTOM_MODEL_CAPABILITIES,
  );
  const [newModelPiRuntime, setNewModelPiRuntime] = useState<
    ProviderModelPiRuntimeConfig | undefined
  >(undefined);
  const [modelFormError, setModelFormError] = useState<string | null>(null);
  const [pendingDeleteModel, setPendingDeleteModel] = useState<{
    id: string;
    name: string;
  } | null>(null);

  // Reset when switching providers or leaving the model tab (keeps token fields).
  const resetModelEditorOnProviderSwitch = () => {
    setIsAddingModel(false);
    setIsEditingModel(false);
    setEditingModelId(null);
    setNewModelName('');
    setNewModelId('');
    setNewModelCapabilities(DEFAULT_CUSTOM_MODEL_CAPABILITIES);
    setModelFormError(null);
  };

  // Reset when adding a custom provider (also clears token fields).
  const resetModelEditorOnCustomProviderAdd = () => {
    setIsAddingModel(false);
    setIsEditingModel(false);
    setEditingModelId(null);
    setNewModelName('');
    setNewModelId('');
    setNewModelCapabilities(DEFAULT_CUSTOM_MODEL_CAPABILITIES);
    setNewModelContextWindow('');
    setNewModelMaxTokens('');
    setModelFormError(null);
  };

  // Handlers for model operations
  const handleAddModel = () => {
    setIsAddingModel(true);
    setIsEditingModel(false);
    setEditingModelId(null);
    setNewModelName('');
    setNewModelId('');
    setNewModelCapabilities(DEFAULT_CUSTOM_MODEL_CAPABILITIES);
    setNewModelPiRuntime(undefined);
    setModelFormError(null);
  };

  const handleEditModel = (
    modelId: string,
    modelName: string,
    supportsImage?: boolean,
    capabilities?: Partial<ModelCapabilities>,
    piRuntime?: ProviderModelPiRuntimeConfig,
    contextWindow?: number,
    maxTokens?: number,
  ) => {
    setIsAddingModel(false);
    setIsEditingModel(true);
    setEditingModelId(modelId);
    setNewModelName(modelName);
    setNewModelId(modelId);
    setNewModelContextWindow(formatTokenK(contextWindow));
    setNewModelMaxTokens(formatTokenK(maxTokens));
    setNewModelCapabilities({
      ...DEFAULT_CUSTOM_MODEL_CAPABILITIES,
      ...capabilities,
      imageInput:
        capabilities?.imageInput ??
        (supportsImage ? ModelCapabilityStatus.Supported : ModelCapabilityStatus.Unsupported),
    });
    setNewModelPiRuntime(piRuntime);
    setModelFormError(null);
  };

  const handleDeleteModel = (modelId: string) => {
    if (!providers[activeProvider].models) return;
    const model = providers[activeProvider].models.find(item => item.id === modelId);
    if (!model) return;
    setPendingDeleteModel({ id: modelId, name: model.name });
  };

  const confirmDeleteModel = () => {
    if (!pendingDeleteModel || !providers[activeProvider].models) return;
    const modelId = pendingDeleteModel.id;

    setProviders(prev => ({
      ...prev,
      [activeProvider]: {
        ...prev[activeProvider],
        models: prev[activeProvider].models?.filter(model => model.id !== modelId),
      },
    }));
    setPendingDeleteModel(null);
  };

  const handleSaveNewModel = async (): Promise<void> => {
    const modelId = newModelId.trim();

    if (activeProvider === 'ollama') {
      // For Ollama, only the model name (stored as modelId) is required.
      if (!modelId) {
        setModelFormError(i18nService.t('ollamaModelNameRequired'));
        return;
      }
    } else {
      const modelName = newModelName.trim();
      if (!modelName || !modelId) {
        setModelFormError(i18nService.t('modelNameAndIdRequired'));
        return;
      }
    }

    // For Ollama, auto-fill display name from modelId if not provided
    const modelName =
      activeProvider === 'ollama'
        ? newModelName.trim() && newModelName.trim() !== modelId
          ? newModelName.trim()
          : modelId
        : newModelName.trim();

    const contextWindow = parseTokenK(newModelContextWindow);
    const maxTokens = parseTokenK(newModelMaxTokens);
    if (
      (newModelContextWindow.trim() && contextWindow === undefined) ||
      (newModelMaxTokens.trim() && maxTokens === undefined)
    ) {
      setModelFormError(i18nService.t('modelContextWindowInvalid'));
      return;
    }

    if (activeProvider === ProviderName.LlamaCpp) {
      await window.electron.llamacpp.setModelPreference({
        modelName: modelId,
        preference: {
          ...(contextWindow ? { ctxSize: contextWindow } : {}),
          ...(maxTokens ? { maxTokens } : {}),
          capabilities: newModelCapabilities,
        },
      });
      window.dispatchEvent(new CustomEvent(LLAMACPP_RUNNING_MODELS_CHANGED_EVENT));
      handleCancelModelEdit();
      return;
    }

    const currentModels = providers[activeProvider].models ?? [];
    const duplicateModel = currentModels.find(
      model => model.id === modelId && (!isEditingModel || model.id !== editingModelId),
    );
    if (duplicateModel) {
      setModelFormError(i18nService.t('modelIdExists'));
      return;
    }

    const nextModel = {
      id: modelId,
      name: modelName,
      supportsImage: ProviderRegistry.resolveModelSupportsImage(
        activeProvider,
        modelId,
        newModelCapabilities.imageInput === ModelCapabilityStatus.Supported,
      ),
      // 表单保存过的条目视为人工维护,镜像端点的刷新不自动清理。
      origin: ProviderModelOrigin.User,
      ...(contextWindow ? { contextWindow } : {}),
      ...(maxTokens ? { maxTokens } : {}),
      // Remember the form values so reopening the editor shows them.
      // Catalog resolution is unchanged and still decides runtime behavior.
      capabilities: newModelCapabilities,
      ...(isCustomProvider(activeProvider) && newModelPiRuntime
        ? { piRuntime: newModelPiRuntime }
        : {}),
    };
    setProviders(prev => ({
      ...prev,
      [activeProvider]: {
        ...prev[activeProvider],
        models:
          isEditingModel && editingModelId
            ? (prev[activeProvider].models ?? []).map(model =>
                model.id === editingModelId
                  ? {
                      ...nextModel,
                      // Labels and capacity edits do not change the tested model.
                      ...(model.id === modelId && model.piRuntime?.api === nextModel.piRuntime?.api
                        ? { connectionTest: model.connectionTest }
                        : {}),
                    }
                  : model,
              )
            : [...(prev[activeProvider].models ?? []), nextModel],
      },
    }));

    setIsAddingModel(false);
    setIsEditingModel(false);
    setEditingModelId(null);
    setNewModelName('');
    setNewModelId('');
    setNewModelContextWindow('');
    setNewModelMaxTokens('');
    setNewModelCapabilities(DEFAULT_CUSTOM_MODEL_CAPABILITIES);
    setNewModelPiRuntime(undefined);
    setModelFormError(null);
  };

  const handleCancelModelEdit = () => {
    setIsAddingModel(false);
    setIsEditingModel(false);
    setEditingModelId(null);
    setNewModelName('');
    setNewModelId('');
    setNewModelContextWindow('');
    setNewModelMaxTokens('');
    setNewModelCapabilities(DEFAULT_CUSTOM_MODEL_CAPABILITIES);
    setNewModelPiRuntime(undefined);
    setModelFormError(null);
  };

  const handleRowModelEdit = (model: ProviderModelEntry) => {
    const openEditor = (runtimeContextWindow?: number) =>
      handleEditModel(
        model.id,
        model.name,
        model.supportsImage,
        model.capabilities,
        model.piRuntime,
        runtimeContextWindow ?? model.contextWindow,
        model.maxTokens,
      );

    if (activeProvider === ProviderName.LlamaCpp) {
      // 本地模型的编辑框优先用运行时偏好，偏好缺失时退回模型自身配置。
      void window.electron.llamacpp.getModelPreferences().then(preferences => {
        const preference = preferences[model.id];
        handleEditModel(
          model.id,
          model.name,
          model.supportsImage,
          { ...model.capabilities, ...preference?.capabilities },
          undefined,
          preference?.ctxSize ?? model.contextWindow,
          preference?.maxTokens ?? model.maxTokens,
        );
      });
      return;
    }

    if (activeProvider !== ProviderName.Ollama) {
      openEditor();
      return;
    }

    const providerConfig = providers[activeProvider];
    const apiFormat = getEffectiveApiFormat(activeProvider, providerConfig.apiFormat);
    void resolveOllamaModelEditorContext({
      baseUrl: resolveBaseUrl(activeProvider, providerConfig.baseUrl, apiFormat),
      apiFormat,
      apiKey: providerConfig.apiKey,
      modelId: model.id,
    }).then(contextWindow => openEditor(contextWindow));
  };

  const handleRowModelDelete = (model: ProviderModelEntry) => {
    handleDeleteModel(model.id);
  };

  const handleModelEditorDraftChange = (patch: {
    id?: string;
    name?: string;
    contextWindow?: string;
    maxTokens?: string;
    capabilities?: Partial<ModelCapabilities>;
    piRuntime?: ProviderModelPiRuntimeConfig;
  }) => {
    if (patch.id !== undefined) setNewModelId(patch.id);
    if (patch.name !== undefined) setNewModelName(patch.name);
    if (patch.contextWindow !== undefined) setNewModelContextWindow(patch.contextWindow);
    if (patch.maxTokens !== undefined) setNewModelMaxTokens(patch.maxTokens);
    if (patch.capabilities !== undefined) setNewModelCapabilities(patch.capabilities);
    if ('piRuntime' in patch) setNewModelPiRuntime(patch.piRuntime);
    if (modelFormError) setModelFormError(null);
  };

  return {
    isAddingModel,
    isEditingModel,
    editingModelId,
    newModelName,
    newModelId,
    newModelContextWindow,
    newModelMaxTokens,
    newModelCapabilities,
    newModelPiRuntime,
    modelFormError,
    pendingDeleteModel,
    setPendingDeleteModel,
    resetModelEditorOnProviderSwitch,
    resetModelEditorOnCustomProviderAdd,
    handleAddModel,
    handleEditModel,
    handleDeleteModel,
    confirmDeleteModel,
    handleSaveNewModel,
    handleCancelModelEdit,
    handleRowModelEdit,
    handleRowModelDelete,
    handleModelEditorDraftChange,
  };
}
