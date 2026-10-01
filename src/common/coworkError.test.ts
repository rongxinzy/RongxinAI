import { expect, test } from 'vitest';

import {
  classifyCoworkError,
  CoworkErrorKind,
  getErrorLogLevel,
  getUserErrorI18nKey,
  isTransient,
} from './coworkError';

// ─── Model capability unsupported (Fix: deterministic capability errors) ────

const LLAMACPP_MM_PROJ_500 =
  '500 {"code":500,"message":"image input is not supported - hint: the model may not support vision or the mmproj file is missing","type":"server_error"}';

test('llama.cpp mmproj 500 classifies as ModelCapabilityUnsupported, not ServerError', () => {
  const result = classifyCoworkError(LLAMACPP_MM_PROJ_500);
  expect(result.kind).toBe(CoworkErrorKind.ModelCapabilityUnsupported);
  expect(result.statusCode).toBe(500);
});

test('capability errors from other wordings classify as ModelCapabilityUnsupported', () => {
  expect(classifyCoworkError('model does not support image input').kind).toBe(
    CoworkErrorKind.ModelCapabilityUnsupported,
  );
  expect(classifyCoworkError('this model does not support vision input').kind).toBe(
    CoworkErrorKind.ModelCapabilityUnsupported,
  );
  expect(classifyCoworkError('modality not supported by this endpoint').kind).toBe(
    CoworkErrorKind.ModelCapabilityUnsupported,
  );
});

test('ModelCapabilityUnsupported is not transient', () => {
  expect(isTransient(CoworkErrorKind.ModelCapabilityUnsupported)).toBe(false);
});

test('ModelCapabilityUnsupported logs at error level', () => {
  expect(getErrorLogLevel(CoworkErrorKind.ModelCapabilityUnsupported)).toBe('error');
});

test('ModelCapabilityUnsupported maps to its own i18n key', () => {
  expect(getUserErrorI18nKey(CoworkErrorKind.ModelCapabilityUnsupported)).toBe(
    'coworkErrorModelCapabilityUnsupported',
  );
});

test('plain 500 without capability wording still classifies as ServerError', () => {
  const result = classifyCoworkError('Request failed with status 500');
  expect(result.kind).toBe(CoworkErrorKind.ServerError);
  expect(isTransient(result.kind)).toBe(true);
});

// ─── Provider unavailable (Fix: actionable continue errors) ─────────────────

test('disabled provider error classifies as ProviderUnavailable', () => {
  expect(classifyCoworkError('Provider custom_0 is not enabled.').kind).toBe(
    CoworkErrorKind.ProviderUnavailable,
  );
});

test('missing provider model error classifies as ProviderUnavailable', () => {
  expect(classifyCoworkError('No enabled provider found for model: qwen-local').kind).toBe(
    CoworkErrorKind.ProviderUnavailable,
  );
});

test('ProviderUnavailable is not transient', () => {
  expect(isTransient(CoworkErrorKind.ProviderUnavailable)).toBe(false);
});

test('ProviderUnavailable logs at error level', () => {
  expect(getErrorLogLevel(CoworkErrorKind.ProviderUnavailable)).toBe('error');
});

test('ProviderUnavailable maps to its own i18n key', () => {
  expect(getUserErrorI18nKey(CoworkErrorKind.ProviderUnavailable)).toBe(
    'coworkErrorProviderUnavailable',
  );
});
