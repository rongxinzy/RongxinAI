import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const readSource = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

const appSource = readSource('../../App.tsx');
const settingsPageSource = readSource('../settings/SettingsPage.tsx');
const modelSettingsPanelSource = readSource('../settings/model/ModelSettingsPanel.tsx');
const localInferenceSource = readSource('./LocalInferenceView.tsx');
const modelsPanelSource = readSource('./panels/ModelsPanel.tsx');

test('keeps model-load cancellation reachable through the loading overlay', () => {
  expect(modelsPanelSource).toContain('pointer-events-none absolute inset-0');
  expect(modelsPanelSource).toContain('className="pointer-events-auto"');
  expect(modelsPanelSource).toContain('data-local-inference-cancel-load-button="true"');
  expect(modelsPanelSource).toContain('{loadingModel ? null : isRunning ? (');
});

test('opens the unified model settings after starting a local model', () => {
  expect(appSource).toContain('const handleOpenLocalModelSettings = useCallback(() =>');
  expect(appSource).toContain("handleShowSettings({ initialTab: 'model' });");
  expect(appSource).toContain('onOpenModelSettings={handleOpenLocalModelSettings}');
  expect(appSource).toContain('initialTab={settingsOptions.initialTab}');
});

test('routes model settings to the unified catalog and default selection', () => {
  expect(settingsPageSource).toContain("activeTab === 'model' && <ModelSettingsPanel />");
  expect(modelSettingsPanelSource).toContain('apply(await refreshMagpieModels())');
  expect(modelSettingsPanelSource).toContain('selectMagpieDefaultModel(selection)');
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
