import { useCallback, useRef } from 'react';

import {
  applyProviderModelConnectionTestResults,
  createProviderConnectionTestSignature,
  ProviderName,
  ProviderRegistry,
  type DiscoveredProviderModel,
  type ProviderModelConnectionFailureKind,
} from '../../../../shared/providers';
import { defaultConfig, isCustomProvider } from '../../../config';
import { configService } from '../../../services/config';
import { i18nService } from '../../../services/i18n';
import {
  testProviderModelConnection,
  testProviderModelsConcurrently,
} from '../../../services/providerModelConnection';
import {
  createDiscoveredProviderModel,
  mergeDiscoveredProviderModels,
} from '../../../services/providerModelDiscovery';
import {
  buildProviderModelConnectionTestNotification,
  buildProviderModelConnectionTestProgressNotification,
  MODEL_CONNECTION_TEST_PROGRESS_INTERVAL_MS,
  shouldReportProviderModelConnectionTestProgress,
} from '../modelConnectionTestNotification';
import { ModelConnectionStatus } from '../useModelConnectionStatus';
import type { ProviderModelEntry } from '../ProviderModelRow';
import type { ProviderConfig, ProvidersConfig, ProviderType } from './constants';
import { getEffectiveApiFormat, providerRequiresApiKey, resolveBaseUrl } from './providerUtils';

interface UseConnectionTestParams {
  providers: ProvidersConfig;
  setProviders: React.Dispatch<React.SetStateAction<ProvidersConfig>>;
  activeProvider: ProviderType;
  selectedModelId: string;
  setSelectedModelId: React.Dispatch<React.SetStateAction<string>>;
  enableProvider: (provider: ProviderType) => void;
  modelConnectionTestRequestIdRef: React.MutableRefObject<Partial<Record<ProviderType, number>>>;
  mergeProviderModelConnectionStatuses: (
    provider: string,
    statuses: Record<string, ModelConnectionStatus>,
  ) => void;
  setModelConnectionStatus: (
    provider: string,
    modelId: string,
    status: ModelConnectionStatus,
  ) => void;
  setProviderModelConnectionStatuses: (
    provider: string,
    statuses: Record<string, ModelConnectionStatus>,
  ) => void;
}

export function useConnectionTest({
  providers,
  setProviders,
  activeProvider,
  selectedModelId,
  setSelectedModelId,
  enableProvider,
  modelConnectionTestRequestIdRef,
  mergeProviderModelConnectionStatuses,
  setModelConnectionStatus,
  setProviderModelConnectionStatuses,
}: UseConnectionTestParams) {
  const providersRef = useRef(providers);
  providersRef.current = providers;

  // Single source of truth for the providers draft: apply the update to the
  // ref synchronously and mirror it into React state, so asynchronous test
  // continuations always read the latest draft instead of a stale render
  // snapshot. Writing the ref and the state separately lets an edit in
  // between fork the two and drop updates. The ref write must stay
  // synchronous: a functional setProviders updater only runs at render time
  // (under act/concurrent React that can be arbitrarily later), while
  // continuations between dispatch and render already read the ref.
  const updateProviders = useCallback(
    (updater: (current: ProvidersConfig) => ProvidersConfig) => {
      const next = updater(providersRef.current);
      providersRef.current = next;
      setProviders(next);
    },
    [setProviders],
  );

  const startConnectionTest = useCallback(
    (provider: ProviderType, snapshot: ProviderConfig) => {
      const requestId = (modelConnectionTestRequestIdRef.current[provider] ?? 0) + 1;
      modelConnectionTestRequestIdRef.current[provider] = requestId;
      return () => {
        const current = providersRef.current[provider];
        return (
          modelConnectionTestRequestIdRef.current[provider] === requestId &&
          current !== undefined &&
          current.apiKey === snapshot.apiKey &&
          current.baseUrl === snapshot.baseUrl &&
          current.apiFormat === snapshot.apiFormat &&
          current.codingPlanEnabled === snapshot.codingPlanEnabled &&
          current.authType === snapshot.authType &&
          current.oauthAccessToken === snapshot.oauthAccessToken
        );
      };
    },
    [modelConnectionTestRequestIdRef],
  );

  const showConnectionTestNotification = (
    result: { success: boolean; message: string },
    provider: ProviderType,
    model?: Pick<NonNullable<ProviderConfig['models']>[number], 'id' | 'name'>,
  ) => {
    const providerLabel = ProviderRegistry.get(provider)?.label ?? provider;
    const modelName = model?.name.trim();
    const modelId = model?.id;
    const modelLabel =
      modelName && modelId && modelName !== modelId ? `${modelName} (${modelId})` : modelId;
    const subject = modelLabel ?? providerLabel;
    const message = result.success
      ? `${subject}: ${i18nService.t('connectionSuccess')}`
      : `${subject}: ${result.message}`;
    window.dispatchEvent(
      new CustomEvent('app:showToast', {
        detail: {
          message,
          isError: !result.success,
          isSuccess: result.success,
          autoClose: true,
          durationMs: result.success ? undefined : 5_000,
        },
      }),
    );
  };

  // Persist the connectionTest verdicts of the tested models into the latest
  // stored provider entry. Only the tested models' connectionTest fields are
  // merged by model id; every other stored field (enabled, baseUrl, models
  // the test did not cover, ...) is left untouched, and a stored entry missing
  // the provider or holding a different model API is never recreated or
  // overwritten. With appendDiscovered, tested models absent from storage are
  // appended with their verdict (discovery flow) instead of being dropped —
  // rebuilt from the discovery payload, so unsaved form edits to fields other
  // than the verdict never leak into storage without an explicit save.
  const persistTestedProviderModels = async (
    provider: ProviderType,
    testedModels: readonly NonNullable<ProviderConfig['models']>[number][],
    isCurrent: () => boolean,
    options: { appendDiscovered?: readonly DiscoveredProviderModel[] } = {},
  ): Promise<void> => {
    if (provider === ProviderName.LlamaCpp) return;
    await configService.updateConfig(currentConfig => {
      if (!isCurrent()) return;
      const storedProvider = currentConfig.providers?.[provider];
      if (!storedProvider) return;

      const testedById = new Map(testedModels.map(model => [model.id, model]));
      let changed = false;
      const mergedModels = (storedProvider.models ?? []).map(model => {
        const tested = testedById.get(model.id);
        if (!tested || tested.connectionTest === undefined) return model;
        if (tested.piRuntime?.api !== model.piRuntime?.api) return model;
        // Skip the write when the stored verdict already carries the same
        // outcome for the same connection signature (testedAt alone differs).
        const storedTest = model.connectionTest;
        const testedTest = tested.connectionTest;
        if (
          storedTest &&
          storedTest.status === testedTest.status &&
          storedTest.signature === testedTest.signature &&
          storedTest.failureKind === testedTest.failureKind
        ) {
          return model;
        }
        changed = true;
        return { ...model, connectionTest: testedTest };
      });

      let nextModels = mergedModels;
      if (options.appendDiscovered) {
        const discoveredById = new Map(options.appendDiscovered.map(model => [model.id, model]));
        const knownIds = new Set(mergedModels.map(model => model.id));
        for (const tested of testedModels) {
          if (knownIds.has(tested.id) || tested.connectionTest === undefined) continue;
          const discovered = discoveredById.get(tested.id);
          // Models that exist only in the form draft (manual additions or
          // unsaved edits) are not persisted here; the save button owns those.
          if (!discovered) continue;
          knownIds.add(tested.id);
          changed = true;
          nextModels = [
            ...nextModels,
            { ...createDiscoveredProviderModel(discovered), connectionTest: tested.connectionTest },
          ];
        }
      }

      if (!changed) return;
      return {
        providers: {
          ...(currentConfig.providers ?? {}),
          [provider]: { ...storedProvider, models: nextModels },
        },
      };
    });
  };

  const completeSuccessfulConnectionTest = async (
    provider: ProviderType,
    model: NonNullable<ProviderConfig['models']>[number],
    outcomes: ReadonlyArray<{
      modelId: string;
      success: boolean;
      failureKind?: ProviderModelConnectionFailureKind;
    }>,
    signature: string,
    isCurrent: () => boolean,
  ): Promise<void> => {
    try {
      const testedProviderConfig = applyProviderModelConnectionTestResults(
        { models: [{ ...model }] },
        outcomes,
        signature,
      );
      await persistTestedProviderModels(provider, testedProviderConfig.models ?? [], isCurrent);
      if (!isCurrent()) return;
      if (provider !== ProviderName.LlamaCpp) {
        enableProvider(provider);
      }
      showConnectionTestNotification(
        { success: true, message: i18nService.t('connectionSuccess') },
        provider,
        model,
      );
    } catch (error) {
      if (!isCurrent()) return;
      console.error('[Settings] failed to save tested provider configuration:', error);
      showConnectionTestNotification(
        { success: false, message: i18nService.t('failedToSaveSettings') },
        provider,
        model,
      );
    }
  };

  // 测试 API 连接
  const handleTestConnection = async (requestedModelId?: string) => {
    const testingProvider = activeProvider;
    const providerConfig = providers[testingProvider];
    if (!providerConfig) return;
    const hasValidAuth = providerConfig.apiKey;

    if (providerRequiresApiKey(testingProvider) && !hasValidAuth) {
      showConnectionTestNotification(
        { success: false, message: i18nService.t('apiKeyRequired') },
        testingProvider,
      );
      return;
    }

    // Allocate before any asynchronous work so configuration edits invalidate
    // even a request still waiting for its signature or local-model lookup.
    const isCurrent = startConnectionTest(testingProvider, providerConfig);

    const selectedModel = providerConfig.models?.find(
      model => model.id === (requestedModelId ?? selectedModelId),
    );
    let firstModel = selectedModel
      ? { ...selectedModel }
      : providerConfig.models?.[0]
        ? { ...providerConfig.models[0] }
        : undefined;

    if (testingProvider === ProviderName.LlamaCpp) {
      const runningModels = await window.electron.llamacpp.listRunningModels().catch(() => []);
      if (!isCurrent()) return;
      const runningModelNames = runningModels
        .map(model => model.name?.trim() || model.model?.trim() || model.id?.trim() || '')
        .filter(Boolean);
      if (runningModelNames.length === 0) {
        showConnectionTestNotification(
          {
            success: false,
            message: i18nService.t('agentLlamaCppModelNotRunningBlocked'),
          },
          testingProvider,
        );
        return;
      }
      const matchedConfiguredModel = (providerConfig.models ?? []).find(
        model => runningModelNames.includes(model.id) || runningModelNames.includes(model.name),
      );
      firstModel = matchedConfiguredModel
        ? { ...matchedConfiguredModel }
        : {
            id: runningModelNames[0],
            name: runningModelNames[0],
            supportsImage: false,
          };
    }

    if (!firstModel) {
      showConnectionTestNotification(
        { success: false, message: i18nService.t('noModelsConfigured') },
        testingProvider,
      );
      return;
    }

    if (
      testingProvider === 'qwen' &&
      (firstModel.id === 'vision-model' || firstModel.id === 'coder-model')
    ) {
      const defaultQwenModel = defaultConfig.providers?.qwen?.models?.[0];
      firstModel.id = defaultQwenModel?.id || 'qwen3.5-plus';
    }

    const testingApiFormat = getEffectiveApiFormat(testingProvider, providerConfig.apiFormat);
    const testingBaseUrl = resolveBaseUrl(
      testingProvider,
      providerConfig.baseUrl,
      testingApiFormat,
    );
    const connectionSignature = await createProviderConnectionTestSignature({
      providerId: testingProvider,
      baseUrl: testingBaseUrl,
      apiFormat: testingApiFormat,
      provider: providerConfig,
    });
    if (!isCurrent()) return;
    const result = await testProviderModelConnection({
      providerId: testingProvider,
      provider: providerConfig,
      baseUrl: testingBaseUrl,
      apiFormat: testingApiFormat,
      model: firstModel,
    });
    if (!isCurrent()) return;

    const currentProviderConfig = providersRef.current[testingProvider];
    if (
      testingProvider !== ProviderName.LlamaCpp &&
      !currentProviderConfig.models?.some(
        model => model.id === firstModel.id && model.piRuntime?.api === firstModel.piRuntime?.api,
      )
    )
      return;

    setModelConnectionStatus(
      testingProvider,
      firstModel.id,
      result.success ? ModelConnectionStatus.Success : ModelConnectionStatus.Failure,
    );
    const outcomes = [
      {
        modelId: firstModel.id,
        success: result.success,
        failureKind: result.success ? undefined : result.failureKind,
      },
    ];
    const testedAt = Date.now();
    updateProviders(current => ({
      ...current,
      [testingProvider]: applyProviderModelConnectionTestResults(
        current[testingProvider],
        outcomes,
        connectionSignature,
        testedAt,
      ),
    }));

    if (result.success) {
      await completeSuccessfulConnectionTest(
        testingProvider,
        firstModel,
        outcomes,
        connectionSignature,
        isCurrent,
      );
    } else {
      const testedProviderConfig = applyProviderModelConnectionTestResults(
        { models: [{ ...firstModel }] },
        outcomes,
        connectionSignature,
        testedAt,
      );
      await persistTestedProviderModels(
        testingProvider,
        testedProviderConfig.models ?? [],
        isCurrent,
      );
      if (!isCurrent()) return;
      showConnectionTestNotification(
        { success: false, message: result.message },
        testingProvider,
        firstModel,
      );
    }
  };

  const handleRowModelTest = (model: ProviderModelEntry) => {
    setSelectedModelId(model.id);
    void handleTestConnection(model.id);
  };

  const handleModelsDiscovered = useCallback(
    async (
      providerId: string,
      discoveredModels: readonly DiscoveredProviderModel[],
    ): Promise<void> => {
      const provider = providerId as ProviderType;
      const providerConfig = providersRef.current[provider];
      if (!providerConfig) return;
      // 自定义 provider 与 Ollama 的模型列表语义是镜像当前端点:端点不再返回、且非手动
      // 添加(origin "user")的条目随刷新移除,避免历史 URL 遗留的失效模型持续累积。
      // 内置 provider 的列表是官方目录加端点补充,保持只增不减的合并语义。
      const mirrorEndpoint = isCustomProvider(provider) || provider === ProviderName.Ollama;
      const merged = mergeDiscoveredProviderModels(providerConfig.models ?? [], discoveredModels, {
        pruneMissing: mirrorEndpoint,
      });
      const modelsToTest = merged.models;
      // 一个模型都没发现时列表保持原样，也不必把已有模型再测一遍；空结果由调用方提示。
      if (discoveredModels.length === 0 || modelsToTest.length === 0) return;
      const isCurrent = startConnectionTest(provider, providerConfig);

      if (provider === activeProvider && discoveredModels.length > 0) {
        setSelectedModelId(current => current || discoveredModels[0].id);
      }
      updateProviders(current => ({
        ...current,
        [provider]: {
          ...current[provider],
          models: mergeDiscoveredProviderModels(current[provider].models ?? [], discoveredModels, {
            pruneMissing: mirrorEndpoint,
          }).models,
        },
      }));

      // Run connection tests in the background so the discovery button stops
      // loading once the model list is merged. Each finished test writes its own
      // status dot, so the list shows progress while the batch is still running.
      // 模型多的提供商（如 Qwen 上百个模型）整批要跑很久，列表里的状态点容易被忽略，
      // 所以整批期间挂一条中性进度提示，结束时由结果汇总提示替换掉它。
      let testedCount = 0;
      const reportProgress = () => {
        window.dispatchEvent(
          new CustomEvent('app:showToast', {
            detail: buildProviderModelConnectionTestProgressNotification({
              tested: testedCount,
              total: modelsToTest.length,
            }),
          }),
        );
      };
      let progressTimer: number | null = null;
      if (shouldReportProviderModelConnectionTestProgress(modelsToTest.length)) {
        progressTimer = window.setInterval(() => {
          if (!isCurrent()) {
            if (progressTimer !== null) window.clearInterval(progressTimer);
            return;
          }
          reportProgress();
        }, MODEL_CONNECTION_TEST_PROGRESS_INTERVAL_MS);
        reportProgress();
      }

      void (async () => {
        const testingApiFormat = getEffectiveApiFormat(provider, providerConfig.apiFormat);
        const testingBaseUrl = resolveBaseUrl(provider, providerConfig.baseUrl, testingApiFormat);
        const connectionSignature = await createProviderConnectionTestSignature({
          providerId: provider,
          baseUrl: testingBaseUrl,
          apiFormat: testingApiFormat,
          provider: providerConfig,
        });
        if (!isCurrent()) return;
        // 结果回来的节奏不可控（快速失败时会成批返回），按帧合并成一次状态更新，
        // 避免整张列表跟着每个模型重渲染一遍。
        const pendingConnectionStatuses: Record<string, ModelConnectionStatus> = {};
        let flushScheduled = false;
        const flushModelConnectionStatuses = () => {
          flushScheduled = false;
          if (!isCurrent()) return;
          const currentModelIds = new Set(
            providersRef.current[provider].models?.map(model => model.id),
          );
          mergeProviderModelConnectionStatuses(
            provider,
            Object.fromEntries(
              Object.entries(pendingConnectionStatuses).filter(([id]) => currentModelIds.has(id)),
            ),
          );
        };
        const queueModelConnectionStatus = (modelId: string, status: ModelConnectionStatus) => {
          pendingConnectionStatuses[modelId] = status;
          if (flushScheduled) return;
          flushScheduled = true;
          window.requestAnimationFrame(flushModelConnectionStatuses);
        };

        const results = await testProviderModelsConcurrently({
          providerId: provider,
          provider: providerConfig,
          baseUrl: testingBaseUrl,
          apiFormat: testingApiFormat,
          models: modelsToTest,
          onResult: ({ model, result }) => {
            if (!isCurrent()) return;
            testedCount += 1;
            queueModelConnectionStatus(
              model.id,
              result.success ? ModelConnectionStatus.Success : ModelConnectionStatus.Failure,
            );
          },
        });
        if (!isCurrent()) return;

        const currentProviderConfig = providersRef.current[provider];
        const currentModels = new Map(
          currentProviderConfig.models?.map(model => [model.id, model]),
        );
        const currentResults = results.filter(
          ({ model }) =>
            currentModels.has(model.id) &&
            currentModels.get(model.id)?.piRuntime?.api === model.piRuntime?.api,
        );
        if (currentResults.length === 0) return;
        const outcomes = currentResults.map(({ model, result }) => ({
          modelId: model.id,
          success: result.success,
          failureKind: result.success ? undefined : result.failureKind,
        }));
        const testedAt = Date.now();
        const testedProviderConfig = applyProviderModelConnectionTestResults(
          currentProviderConfig,
          outcomes,
          connectionSignature,
          testedAt,
        );
        updateProviders(current => ({
          ...current,
          [provider]: applyProviderModelConnectionTestResults(
            current[provider],
            outcomes,
            connectionSignature,
            testedAt,
          ),
        }));

        const statuses = Object.fromEntries(
          currentResults.map(({ model, result }) => [
            model.id,
            result.success ? ModelConnectionStatus.Success : ModelConnectionStatus.Failure,
          ]),
        );
        setProviderModelConnectionStatuses(provider, statuses);

        // Persist whatever the batch produced, success or failure: merge each
        // tested model's verdict into the latest stored entry and append
        // discovered models the user has not saved yet, without touching any
        // other stored field. A fully failed batch used to be dropped silently
        // when the provider was not saved yet, losing the discovered models.
        const successCount = currentResults.filter(({ result }) => result.success).length;
        const testedModelIds = new Set(outcomes.map(outcome => outcome.modelId));
        const testedModels = (testedProviderConfig.models ?? []).filter(model =>
          testedModelIds.has(model.id),
        );
        try {
          await persistTestedProviderModels(provider, testedModels, isCurrent, {
            appendDiscovered: discoveredModels,
          });
          if (!isCurrent()) return;
          if (successCount > 0 && provider !== ProviderName.LlamaCpp) enableProvider(provider);
        } catch (error) {
          if (!isCurrent()) return;
          console.error('[Settings] failed to save auto-tested provider configuration:', error);
          showConnectionTestNotification(
            { success: false, message: i18nService.t('failedToSaveSettings') },
            provider,
          );
          return;
        }
        if (!isCurrent()) return;

        // 结果汇总在这里同步派发，且必须早于 finally 清掉 interval：App 的 Toast 宿主每收到
        // 一次 app:showToast 就覆盖文案并重置自动关闭计时器，所以最后留在屏幕上的是这条结果，
        // 进度提示会被原地替换而不是挂在顶部（调度上 finally 是 microtask，interval 是 macrotask，
        // 不可能插在两者之间多刷一条进度）。这条顺序由 modelConnectionTestToast.test.ts 锁住。
        const firstFailed = currentResults.find(({ result }) => !result.success);
        const firstFailureMessage =
          firstFailed && !firstFailed.result.success ? firstFailed.result.message : undefined;

        window.dispatchEvent(
          new CustomEvent('app:showToast', {
            detail: buildProviderModelConnectionTestNotification({
              total: currentResults.length,
              successCount,
              firstFailureMessage,
            }),
          }),
        );
      })()
        .catch(error => {
          if (!isCurrent()) return;
          console.error('[Settings] provider model connection batch failed:', error);
          showConnectionTestNotification(
            { success: false, message: i18nService.t('modelConnectionTestBatchFailed') },
            provider,
          );
        })
        .finally(() => {
          if (progressTimer !== null) window.clearInterval(progressTimer);
        });
    },
    [
      activeProvider,
      enableProvider,
      mergeProviderModelConnectionStatuses,
      setProviderModelConnectionStatuses,
      setSelectedModelId,
      startConnectionTest,
      updateProviders,
    ],
  );

  return {
    handleTestConnection,
    handleRowModelTest,
    handleModelsDiscovered,
  };
}
