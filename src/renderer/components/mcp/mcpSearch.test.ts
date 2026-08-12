import { expect, test } from 'vitest';

import { filterMcpItems } from './mcpSearch';

test('returns every item when the search query is empty', () => {
  const items = [{ name: 'GitHub' }, { name: 'Notion' }];

  expect(filterMcpItems(items, '  ', item => item.name)).toEqual(items);
});

test('matches search text without case sensitivity', () => {
  const items = [
    { name: 'GitHub', description: 'Manage repositories' },
    { name: 'Notion', description: 'Organize notes' },
  ];

  expect(filterMcpItems(items, 'REPOSITORIES', item => `${item.name} ${item.description}`)).toEqual(
    [items[0]],
  );
});
