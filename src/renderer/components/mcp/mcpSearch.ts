import { useState } from 'react';

export function useMcpSearchQuery() {
  return useState('');
}

export function filterMcpItems<Item>(
  items: readonly Item[],
  searchQuery: string,
  getSearchText: (item: Item) => string,
) {
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
  if (!normalizedQuery) return [...items];

  return items.filter(item => getSearchText(item).toLocaleLowerCase().includes(normalizedQuery));
}
