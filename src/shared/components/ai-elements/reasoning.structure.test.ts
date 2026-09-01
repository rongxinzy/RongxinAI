import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./reasoning.tsx', import.meta.url)), 'utf8');

test('renders streaming reasoning as stable preformatted text', () => {
  const contentStart = source.indexOf('export const ReasoningContent');
  const contentEnd = source.indexOf('Reasoning.displayName');
  const contentSource = source.slice(contentStart, contentEnd);

  expect(contentSource).toContain('const { isStreaming, showConnector } = useReasoning();');
  expect(contentSource).toContain('isStreaming ?');
  expect(contentSource).toContain('whitespace-pre-wrap wrap-break-word');
});

test('keeps Markdown rendering for completed reasoning', () => {
  const contentStart = source.indexOf('export const ReasoningContent');
  const contentEnd = source.indexOf('Reasoning.displayName');
  const contentSource = source.slice(contentStart, contentEnd);

  expect(contentSource).toContain('RICH_CONTENT_PATTERN.test(text)');
  expect(contentSource).toContain('<RichMessageResponse>{children}</RichMessageResponse>');
  expect(contentSource).toContain('<Streamdown plugins={basePlugins}>{children}</Streamdown>');
});
