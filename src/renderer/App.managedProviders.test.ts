import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const appSource = readFileSync(fileURLToPath(new URL('./App.tsx', import.meta.url)), 'utf8');

// App is not render-mounted in unit tests; these assertions pin the exclusive managed
// provider wiring so regressions in the effect guards are caught.
test('refreshes available models when the managed provider projection changes', () => {
  const handlerMatch = appSource.match(
    /const handleManagedProvidersChanged = \(\) => \{[\s\S]*?\};/,
  );
  expect(handlerMatch).not.toBeNull();
  expect(handlerMatch?.[0]).toContain('void refreshAvailableModels();');
  expect(appSource).toContain('window.electron.managedProviders.onChanged(');
  expect(appSource).toContain('unsubscribeManagedProviders();');
});

test('refreshes the unified model catalog without writing a renderer selection to app config', () => {
  expect(appSource).toContain('refreshMagpieModels(),');
  expect(appSource).toContain('window.electron.managedProviders.policy(),');
  expect(appSource).not.toContain('configService.updateConfig(');
});
