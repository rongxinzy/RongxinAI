import { readFileSync } from 'node:fs';

import { expect, test } from 'vitest';

import { themePlugins } from '../theme/themes/plugins';

test('uses the same theme-owned icon slot for every settings entry', () => {
  const source = readFileSync(new URL('./Settings.tsx', import.meta.url), 'utf8');
  const navigation = source.slice(source.indexOf('{sidebarTabs.map'), source.indexOf('</nav>'));

  expect(navigation).toMatch(
    /<span\s+className="theme-settings-navigation-icon[^"]*"\s+aria-hidden="true"\s*>\s*\{tab.icon\}\s*<\/span>/,
  );
  expect(navigation).toContain('min-w-0 truncate');
});

test('provides a consistent settings icon slot in every theme and appearance', () => {
  for (const plugin of themePlugins) {
    for (const appearance of Object.values(plugin.appearances)) {
      expect(appearance.components['settings-navigation-icon'].base).toEqual({
        width: '1.25rem',
        height: '1.25rem',
      });
    }
  }
});
