import { readFileSync } from 'node:fs';

import { expect, test } from 'vitest';

import { themePlugins } from '../theme/themes/plugins';

test('uses main-sidebar navigation semantics for every settings category entry', () => {
  const source = readFileSync(new URL('./settings/SettingsPage.tsx', import.meta.url), 'utf8');
  const navigation = source.slice(source.indexOf('{navGroups.map'), source.indexOf('</nav>'));

  expect(navigation).toContain('variant="navigation"');
  expect(navigation).toContain('size="navigation"');
  expect(navigation).toContain('data-active={activeTab === tab.key || undefined}');
  expect(navigation).toContain("aria-current={activeTab === tab.key ? 'page' : undefined}");
  expect(navigation).toContain('strokeWidth={1.75}');
  expect(navigation).toContain('min-w-0 truncate');
  expect(navigation).not.toContain('theme-settings-navigation-icon');
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
