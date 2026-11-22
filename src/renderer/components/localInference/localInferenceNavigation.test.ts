import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const readSource = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

const appSource = readSource('../../App.tsx');
const mainViewCanvasSource = readSource('../../app/MainViewCanvas.tsx');
const settingsPageSource = readSource('../settings/SettingsPage.tsx');
const modelsPageSource = readSource('../settings/model/ModelsPage.tsx');
const localInferenceSource = readSource('./LocalInferenceView.tsx');

test('opens the unified model settings after starting a local model', () => {
  expect(appSource).toContain('const handleOpenLocalModelSettings = useCallback(() =>');
  expect(appSource).toContain("handleShowSettings({ initialTab: 'models' });");
  expect(appSource).toContain('onOpenModelSettings={handleOpenLocalModelSettings}');
  expect(mainViewCanvasSource).toContain('initialTab={settingsOptions.initialTab}');
});

test('routes model settings to the unified catalog and default selection', () => {
  expect(settingsPageSource).toContain("activeTab === 'models' && (");
  expect(settingsPageSource).toContain('<ModelsPage');
  expect(modelsPageSource).toContain('await refreshMagpieModels()');
  expect(modelsPageSource).toContain('selectMagpieDefaultModel(item.id)');
});

test('refreshes the kept-alive local inference view on navigation requests', () => {
  expect(appSource).toContain('setLocalInferenceRefreshRequestId(current => current + 1);');
  expect(mainViewCanvasSource).toContain('refreshRequestId={localInferenceRefreshRequestId}');
  expect(localInferenceSource).toContain('refreshRequestId?: number;');
  expect(localInferenceSource).toContain('if (!isVisible) return;');
  expect(localInferenceSource).toContain('refreshRequestId,');
  expect(localInferenceSource).toContain('await refreshLocalModels();');
  expect(localInferenceSource).toContain('await refreshModelsDir();');
  expect(localInferenceSource).toContain('await refreshModelPreferences();');
});
