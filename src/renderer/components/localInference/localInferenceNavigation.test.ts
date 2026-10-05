import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const readSource = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

const appSource = readSource('../../App.tsx');
const providersControllerSource = readSource('../settings/model/useProvidersController.ts');
const connectionTestSource = readSource('../settings/model/useConnectionTest.ts');
const providerModelsSectionSource = readSource('../settings/model/ProviderModelsSection.tsx');
const localInferenceSource = readSource('./LocalInferenceView.tsx');
const modelsPanelSource = readSource('./panels/ModelsPanel.tsx');
const providerModelRowSource = readSource('../settings/ProviderModelRow.tsx');

test('keeps model-load cancellation reachable through the loading overlay', () => {
  expect(modelsPanelSource).toContain('pointer-events-none absolute inset-0');
  expect(modelsPanelSource).toContain('className="pointer-events-auto"');
  expect(modelsPanelSource).toContain('data-local-inference-cancel-load-button="true"');
  expect(modelsPanelSource).toContain('{loadingModel ? null : isRunning ? (');
});

test('opens local model settings after enabling the local provider', () => {
  expect(appSource).toContain('const handleOpenLocalModelSettings = useCallback(async () =>');
  expect(appSource).toContain('await configService.reload();');
  expect(appSource).toContain('[ProviderName.LlamaCpp]: {');
  expect(appSource).toContain('userEnabled: true,');
  expect(appSource).toContain('initialProvider: ProviderName.LlamaCpp,');
  expect(appSource).toContain('onOpenModelSettings={handleOpenLocalModelSettings}');
  expect(appSource).toContain('initialProvider={settingsOptions.initialProvider}');
});

test('keeps the requested provider selected while settings configuration loads', () => {
  expect(providersControllerSource).toContain('initialProvider?: ProviderType;');
  expect(providersControllerSource).toContain('initialProvider ?? getDefaultActiveProvider()');
  expect(providersControllerSource).toContain('if (!initialProvider && config.api)');
  expect(providersControllerSource).toContain('if (!initialProvider && firstEnabledProvider)');
  expect(providersControllerSource).toContain('if (isInitialProviderPending) return;');
  expect(providersControllerSource).toContain('initialProvider === activeProvider ||');
  expect(connectionTestSource).toContain('ModelConnectionStatus.Failure');
  // 双向断言：模型设置面板继续消费提取出来的行组件，LlamaCpp 特判留在组件内部。
  expect(providerModelsSectionSource).toContain('<ProviderModelRow');
  expect(providerModelsSectionSource).toContain('providerId={activeProvider}');
  expect(providerModelRowSource).toContain('providerId === ProviderName.LlamaCpp');
});

test('refreshes the kept-alive local inference view on navigation requests', () => {
  expect(appSource).toContain('setLocalInferenceRefreshRequestId(current => current + 1);');
  expect(appSource).toContain('refreshRequestId={localInferenceRefreshRequestId}');
  expect(localInferenceSource).toContain('refreshRequestId?: number;');
  expect(localInferenceSource).toContain('if (!isVisible) return;');
  expect(localInferenceSource).toContain('refreshRequestId,');
  expect(localInferenceSource).toContain('await refreshLocalModels();');
  expect(localInferenceSource).toContain('await refreshModelsDir();');
  expect(localInferenceSource).toContain('await refreshModelPreferences();');
});
