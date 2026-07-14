import { expect, test } from 'vitest';

import { getLocalInferenceUserFacingErrorMessage } from './errors';

const modelLimitMessage = '\u6a21\u578b\u6570\u91cf\u8fbe\u5230\u4e0a\u9650\uff0c\u8bf7\u5378\u8f7d\u6a21\u578b\u540e\u91cd\u8bd5\u3002';
const serviceStartupFailedMessage = 'llama.cpp \u670d\u52a1\u542f\u52a8\u5931\u8d25';
const vramMessage = '\u663e\u5b58\u4e0d\u8db3\uff0c\u8bf7\u68c0\u67e5\u663e\u5b58\u4f59\u91cf\u3002';

test('removes Electron remote method and technical error prefixes', () => {
  expect(getLocalInferenceUserFacingErrorMessage(
    new Error(
      `Error invoking remote method 'llamacpp:load-model': LlamaCppModelLoadPolicyError: ${modelLimitMessage}`,
    ),
  )).toBe(modelLimitMessage);
});

test('removes a generic Error prefix from IPC failures', () => {
  expect(getLocalInferenceUserFacingErrorMessage(
    new Error(`Error invoking remote method 'llamacpp:start': Error: ${serviceStartupFailedMessage}`),
  )).toBe(serviceStartupFailedMessage);
});

test('keeps already user-facing messages unchanged', () => {
  expect(getLocalInferenceUserFacingErrorMessage(vramMessage)).toBe(vramMessage);
});
