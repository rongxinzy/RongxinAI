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

test('a bare mmproj mention without failure wording is not a capability error', () => {
  expect(classifyCoworkError('loaded the mmproj projector in 240ms').kind).not.toBe(
    CoworkErrorKind.ModelCapabilityUnsupported,
  );
  expect(classifyCoworkError('using mmproj file at /models/vision.mmproj').kind).not.toBe(
    CoworkErrorKind.ModelCapabilityUnsupported,
  );
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

// ─── Input too long / context overflow ─────────────────────────────────────

test('vLLM context overflow with completion tokens classifies as InputTooLong with status 400, not ServerError or 500', () => {
  const vllmError =
    '{"error":{"message":"This model\'s maximum context length is 4096 tokens. However, you requested 5000 tokens (4500 in the messages, 500 in the completion).","type":"BadRequestError","param":null,"code":400}}';
  const result = classifyCoworkError(vllmError);
  expect(result.kind).toBe(CoworkErrorKind.InputTooLong);
  expect(result.kind).not.toBe(CoworkErrorKind.ServerError);
  expect(result.statusCode).toBe(400);
  expect(result.status).toBe(400);
});

test('classifies SGLang context overflow as InputTooLong', () => {
  const sglangError =
    "The input (4500 tokens) is longer than the model's context length (4096 tokens).";
  const result = classifyCoworkError(sglangError);
  expect(result.kind).toBe(CoworkErrorKind.InputTooLong);
  expect(result.statusCode).toBe(400);
  expect(result.status).toBe(400);

  const sglangError2 =
    'The prompt length (4500 tokens) is larger than the maximum context length (4096 tokens).';
  const result2 = classifyCoworkError(sglangError2);
  expect(result2.kind).toBe(CoworkErrorKind.InputTooLong);
  expect(result2.statusCode).toBe(400);
  expect(result2.status).toBe(400);
});

test('classifies live endpoint context overflow errors as InputTooLong', () => {
  const liveError =
    '{"error":{"message":"request (75574 tokens) exceeds the available context size (65536 tokens), try increasing it","type":"exceed_context_size_error","param":"","code":400}}';
  const result = classifyCoworkError(liveError);
  expect(result.kind).toBe(CoworkErrorKind.InputTooLong);
  expect(result.statusCode).toBe(400);
  expect(result.status).toBe(400);

  // Individual phrases
  expect(classifyCoworkError('request exceeds the available context size').kind).toBe(
    CoworkErrorKind.InputTooLong,
  );
  expect(classifyCoworkError('error type: exceed_context_size_error').kind).toBe(
    CoworkErrorKind.InputTooLong,
  );
});

test('classifies Chinese provider context overflow as InputTooLong', () => {
  const chineseError = '输入token超出模型上下文长度限制';
  const result = classifyCoworkError(chineseError);
  expect(result.kind).toBe(CoworkErrorKind.InputTooLong);
  expect(result.statusCode).toBe(400);
  expect(result.status).toBe(400);

  expect(classifyCoworkError('超出模型上下文长度限制').kind).toBe(CoworkErrorKind.InputTooLong);
  expect(classifyCoworkError('输入超出最大长度').kind).toBe(CoworkErrorKind.InputTooLong);
  expect(classifyCoworkError('输入内容过长').kind).toBe(CoworkErrorKind.InputTooLong);
  expect(classifyCoworkError('上下文超出限制').kind).toBe(CoworkErrorKind.InputTooLong);
});

test('classifies context_overflow and prompt too long as InputTooLong', () => {
  expect(classifyCoworkError('context_overflow: maximum context reached').kind).toBe(
    CoworkErrorKind.InputTooLong,
  );
  expect(classifyCoworkError('prompt is too long').kind).toBe(CoworkErrorKind.InputTooLong);
  expect(classifyCoworkError('The input message exceeds the context limit.').kind).toBe(
    CoworkErrorKind.InputTooLong,
  );
  expect(
    classifyCoworkError(
      "This model's maximum context length is 8192 tokens. However, your messages resulted in 9123 tokens. Please reduce the length of the messages.",
    ).kind,
  ).toBe(CoworkErrorKind.InputTooLong);
  expect(classifyCoworkError('Prompt token count of 5000 exceeds the limit of 4096').kind).toBe(
    CoworkErrorKind.InputTooLong,
  );
  expect(
    classifyCoworkError('Your request exceeded model token limit: 5000 (requested: 6000)').kind,
  ).toBe(CoworkErrorKind.InputTooLong);
  expect(classifyCoworkError('Prompt exceeds max length').kind).toBe(CoworkErrorKind.InputTooLong);
  expect(classifyCoworkError('model requires context size of 8192 but got 12000').kind).toBe(
    CoworkErrorKind.InputTooLong,
  );
});

test('extracts 413 status code for standard payload too large errors', () => {
  const result = classifyCoworkError('HTTP 413 Payload Too Large');
  expect(result.kind).toBe(CoworkErrorKind.InputTooLong);
  expect(result.statusCode).toBe(413);
  expect(result.status).toBe(413);
});
