import { readFileSync } from 'node:fs';

import { expect, test } from 'vitest';

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
