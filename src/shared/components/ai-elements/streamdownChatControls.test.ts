import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const controlsSource = readFileSync(
  fileURLToPath(new URL('./streamdownChatControls.ts', import.meta.url)),
  'utf8',
);
const messageSource = readFileSync(fileURLToPath(new URL('./message.tsx', import.meta.url)), 'utf8');
const richSource = readFileSync(
  fileURLToPath(new URL('./richMessageResponse.tsx', import.meta.url)),
  'utf8',
);
const reasoningSource = readFileSync(
  fileURLToPath(new URL('./reasoning.tsx', import.meta.url)),
  'utf8',
);

test('disables markdown table fullscreen that covers the Agent (issue #37)', () => {
  expect(controlsSource).toContain('fullscreen: false');
  expect(messageSource).toContain('controls={streamdownChatControls}');
  expect(richSource).toContain('controls={streamdownChatControls}');
  expect(reasoningSource).toContain('controls={streamdownChatControls}');
});
