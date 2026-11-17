import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./reasoning.tsx', import.meta.url)), 'utf8');

test('renders streaming reasoning with native Streamdown streaming and a bounded viewport', () => {
  const contentStart = source.indexOf('export const ReasoningContent');
  const contentEnd = source.indexOf('Reasoning.displayName');
  const contentSource = source.slice(contentStart, contentEnd);

  expect(contentSource).toContain('const { isStreaming, showConnector } = useReasoning();');
  expect(contentSource).toContain('mode="streaming"');
  expect(contentSource).toContain('parseIncompleteMarkdown={isStreaming}');
  expect(contentSource).toContain('isAnimating={isStreaming}');
  expect(contentSource).toContain('max-h-64 overflow-y-auto');
  expect(contentSource).toContain('scrollbar-gutter-stable');
  expect(contentSource).toContain('[overflow-anchor:none]');
});

test('keeps lazy RichMessageResponse rendering for code/math/mermaid blocks', () => {
  const contentStart = source.indexOf('export const ReasoningContent');
  const contentEnd = source.indexOf('Reasoning.displayName');
  const contentSource = source.slice(contentStart, contentEnd);

  expect(contentSource).toContain('RICH_CONTENT_PATTERN.test(text)');
  expect(contentSource).toContain('<RichMessageResponse');
  expect(contentSource).toContain('<Streamdown');
});
