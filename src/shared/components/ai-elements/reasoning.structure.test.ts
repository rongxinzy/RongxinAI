import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./reasoning.tsx', import.meta.url)), 'utf8');

test('renders streaming reasoning with stable segments and a bounded viewport', () => {
  const contentStart = source.indexOf('export const ReasoningContent');
  const contentEnd = source.indexOf('Reasoning.displayName');
  const contentSource = source.slice(contentStart, contentEnd);

  expect(contentSource).toContain('const { isStreaming, showConnector } = useReasoning();');
  expect(contentSource).toContain('useStreamingTextSegments(text, isStreaming)');
  expect(contentSource).toContain('useAdaptiveTextReveal(tail, shouldAnimateTail)');
  expect(contentSource).toContain('isStreaming ?');
  expect(contentSource).toContain('whitespace-pre-wrap wrap-break-word');
  expect(contentSource).toContain('max-h-64 overflow-y-auto');
  expect(contentSource).toContain('scrollbar-gutter-stable');
  expect(contentSource).toContain('[overflow-anchor:none]');
});

test('keeps Markdown rendering for completed reasoning', () => {
  const contentStart = source.indexOf('export const ReasoningContent');
  const contentEnd = source.indexOf('Reasoning.displayName');
  const contentSource = source.slice(contentStart, contentEnd);

  expect(contentSource).toContain('RICH_CONTENT_PATTERN.test(text)');
  expect(contentSource).toContain('<RichMessageResponse>{text}</RichMessageResponse>');
  expect(contentSource).toContain('<Streamdown plugins={basePlugins}>{text}</Streamdown>');
});
