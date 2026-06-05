import { expect,test } from 'vitest';

import { classifyErrorKey } from './coworkErrorClassify';

const classifyError = (error: string) => classifyErrorKey(error) ?? error;

// ==================== Auth errors ====================

test('auth: Anthropic authentication_error', () => {
  expect(classifyError('authentication_error')).toBe('coworkErrorAuthInvalid');
});

test('auth: DeepSeek authentication_fails', () => {
  expect(classifyError('authentication_fails')).toBe('coworkErrorAuthInvalid');
});

test('auth: OpenAI api key not valid', () => {
  expect(classifyError('Incorrect API key provided: sk-xxx. You can find your API key at https://platform.openai.com/account/api-keys.')).toBe('coworkErrorAuthInvalid');
});

test('auth: OpenAI api_key invalid', () => {
  expect(classifyError('api_key is invalid')).toBe('coworkErrorAuthInvalid');
});

test('auth: Gemini PERMISSION_DENIED', () => {
  expect(classifyError('PERMISSION_DENIED: API key not valid')).toBe('coworkErrorAuthInvalid');
});

test('auth: HTTP 401', () => {
  expect(classifyError('Request failed with status 401')).toBe('coworkErrorAuthInvalid');
});

test('auth: unauthorized', () => {
  expect(classifyError('Unauthorized access')).toBe('coworkErrorAuthInvalid');
});

// ==================== Billing errors ====================

test('billing: DeepSeek insufficient_balance', () => {
  expect(classifyError('insufficient_balance: Your account does not have enough balance')).toBe('coworkErrorInsufficientBalance');
});

test('billing: OpenAI insufficient_quota', () => {
  expect(classifyError('You exceeded your current quota, please check your plan and billing details. insufficient_quota')).toBe('coworkErrorInsufficientBalance');
});

test('billing: OpenRouter insufficient credits', () => {
  expect(classifyError('insufficient credits')).toBe('coworkErrorInsufficientBalance');
});

test('billing: Qwen Arrearage', () => {
  expect(classifyError('Arrearage')).toBe('coworkErrorInsufficientBalance');
});

test('billing: StepFun 余额不足', () => {
  expect(classifyError('账户余额不足，请充值后重试')).toBe('coworkErrorInsufficientBalance');
});

test('billing: HTTP 402', () => {
  expect(classifyError('Request failed with status 402')).toBe('coworkErrorInsufficientBalance');
});

// ==================== Input too long ====================

test('input: context length exceeded', () => {
  expect(classifyError("This model's maximum context length is 8192 tokens. context length exceeded")).toBe('coworkErrorInputTooLong');
});

test('input: input too long', () => {
  expect(classifyError('input too long, please reduce your input')).toBe('coworkErrorInputTooLong');
});

test('input: Qwen Range of input length', () => {
  expect(classifyError('Range of input length should be [1, 6000]')).toBe('coworkErrorInputTooLong');
});

test('input: HTTP 413', () => {
  expect(classifyError('Request failed with status 413')).toBe('coworkErrorInputTooLong');
});

test('input: payload too large', () => {
  expect(classifyError('payload too large')).toBe('coworkErrorInputTooLong');
});

test('input: max_tokens', () => {
  expect(classifyError('max_tokens exceeded')).toBe('coworkErrorInputTooLong');
});

// ==================== PDF ====================

test('pdf: could not process pdf', () => {
  expect(classifyError('Could not process PDF file')).toBe('coworkErrorCouldNotProcessPdf');
});

// ==================== Model not found ====================

test('model: model not found', () => {
  expect(classifyError('model not found: gpt-5')).toBe('coworkErrorModelNotFound');
});

test('model: Qwen Model not exist', () => {
  expect(classifyError('Model not exist')).toBe('coworkErrorModelNotFound');
});

test('model: Ollama model xxx not found', () => {
  expect(classifyError("model 'llama3' not found")).toBe('coworkErrorModelNotFound');
});

// ==================== Gateway / connection ====================

test('gateway: disconnect', () => {
  expect(classifyError('gateway disconnected unexpectedly')).toBe('coworkErrorGatewayDisconnected');
});

test('gateway: client disconnected', () => {
  expect(classifyError('client disconnected')).toBe('coworkErrorGatewayDisconnected');
});

test('gateway: service restart', () => {
  expect(classifyError('service restart in progress')).toBe('coworkErrorServiceRestart');
});

test('gateway: draining', () => {
  expect(classifyError('gateway draining for restart')).toBe('coworkErrorGatewayDraining');
});

// ==================== Content moderation ====================

test('content: Qwen DataInspectionFailed', () => {
  expect(classifyError('DataInspectionFailed')).toBe('coworkErrorContentFiltered');
});

test('content: content filter', () => {
  expect(classifyError('content filter triggered')).toBe('coworkErrorContentFiltered');
});

test('content: 审核未通过', () => {
  expect(classifyError('审核未通过')).toBe('coworkErrorContentFiltered');
});

test('content: StepFun HTTP 451', () => {
  expect(classifyError('Request failed with status 451')).toBe('coworkErrorContentFiltered');
});

test('content: inappropriate content', () => {
  expect(classifyError('inappropriate content detected')).toBe('coworkErrorContentFiltered');
});

// ==================== Rate limit ====================

test('rate: HTTP 429', () => {
  expect(classifyError('Request failed with status 429')).toBe('coworkErrorRateLimit');
});

test('rate: rate_limit', () => {
  expect(classifyError('rate_limit exceeded')).toBe('coworkErrorRateLimit');
});

test('rate: too many requests', () => {
  expect(classifyError('Too many requests, please slow down')).toBe('coworkErrorRateLimit');
});

test('rate: Anthropic overloaded', () => {
  expect(classifyError('overloaded_error: Overloaded')).toBe('coworkErrorRateLimit');
});

test('rate: Gemini RESOURCE_EXHAUSTED', () => {
  expect(classifyError('RESOURCE_EXHAUSTED: quota exceeded')).toBe('coworkErrorRateLimit');
});

// ==================== Network errors ====================

test('network: ECONNREFUSED', () => {
  expect(classifyError('connect ECONNREFUSED 127.0.0.1:443')).toBe('coworkErrorNetworkError');
});

test('network: ENOTFOUND', () => {
  expect(classifyError('getaddrinfo ENOTFOUND api.example.com')).toBe('coworkErrorNetworkError');
});

test('network: ETIMEDOUT', () => {
  expect(classifyError('connect ETIMEDOUT 1.2.3.4:443')).toBe('coworkErrorNetworkError');
});

test('network: could not connect', () => {
  expect(classifyError('could not connect to server')).toBe('coworkErrorNetworkError');
});

// ==================== Server errors ====================

test('server: internal server error', () => {
  expect(classifyError('Internal Server Error')).toBe('coworkErrorServerError');
});

test('server: bad gateway', () => {
  expect(classifyError('Bad Gateway')).toBe('coworkErrorServerError');
});

test('server: HTTP 500', () => {
  expect(classifyError('Request failed with status 500')).toBe('coworkErrorServerError');
});

test('server: HTTP 502', () => {
  expect(classifyError('Request failed with status 502')).toBe('coworkErrorServerError');
});

test('server: HTTP 503', () => {
  expect(classifyError('Request failed with status 503')).toBe('coworkErrorServerError');
});

// ==================== Unrecognized errors (passthrough) ====================

test('unknown: returns original error string', () => {
  const msg = 'Something completely unexpected happened';
  expect(classifyError(msg)).toBe(msg);
});

test('unknown: empty string', () => {
  expect(classifyError('')).toBe('');
});

// ==================== New typed CoworkError model ====================

import {
  classifyCoworkError,
  CoworkErrorKind,
  ENGINE_NOT_READY_CODE,
  getErrorLogLevel,
  getUserErrorI18nKey,
  isTransient,
  makeCoworkError,
} from './coworkError';

// ─── Structured classification ────────────────────────────────────────────

test('typed: classifyCoworkError returns structured object', () => {
  const result = classifyCoworkError('Request failed with status 401');
  expect(result.kind).toBe(CoworkErrorKind.AuthExpired);
  expect(result.statusCode).toBe(401);
  expect(result.message).toBe('Request failed with status 401');
});

test('typed: classifyCoworkError extracts statusCode for rate limit', () => {
  const result = classifyCoworkError('Request failed with status 429');
  expect(result.kind).toBe(CoworkErrorKind.RateLimited);
  expect(result.statusCode).toBe(429);
});

test('typed: classifyCoworkError extracts server error code', () => {
  const result = classifyCoworkError('Request failed with status 502');
  expect(result.kind).toBe(CoworkErrorKind.ServerError);
  expect(result.statusCode).toBe(502);
});

test('typed: classifyCoworkError returns Unknown for unclassified', () => {
  const result = classifyCoworkError('Something completely unexpected');
  expect(result.kind).toBe(CoworkErrorKind.Unknown);
  expect(result.message).toBe('Something completely unexpected');
});

test('typed: classifyCoworkError preserves raw string', () => {
  const raw = 'authentication_error: invalid key';
  const result = classifyCoworkError(raw);
  expect(result.raw).toBe(raw);
});

// ─── Log levels ────────────────────────────────────────────────────────────

test('log: auth expired is error level', () => {
  expect(getErrorLogLevel(CoworkErrorKind.AuthExpired)).toBe('error');
});

test('log: rate limited is warn level', () => {
  expect(getErrorLogLevel(CoworkErrorKind.RateLimited)).toBe('warn');
});

test('log: engine not ready is info level', () => {
  expect(getErrorLogLevel(CoworkErrorKind.EngineNotReady)).toBe('info');
});

test('log: tool permission denied is debug level', () => {
  expect(getErrorLogLevel(CoworkErrorKind.ToolPermissionDenied)).toBe('debug');
});

test('log: server error is warn level', () => {
  expect(getErrorLogLevel(CoworkErrorKind.ServerError)).toBe('warn');
});

test('log: budget exceeded is error level', () => {
  expect(getErrorLogLevel(CoworkErrorKind.BudgetExceeded)).toBe('error');
});

// ─── Transience ────────────────────────────────────────────────────────────

test('transient: rate limited is transient', () => {
  expect(isTransient(CoworkErrorKind.RateLimited)).toBe(true);
});

test('transient: network error is transient', () => {
  expect(isTransient(CoworkErrorKind.NetworkError)).toBe(true);
});

test('transient: server error is transient', () => {
  expect(isTransient(CoworkErrorKind.ServerError)).toBe(true);
});

test('transient: gateway disconnected is transient', () => {
  expect(isTransient(CoworkErrorKind.GatewayDisconnected)).toBe(true);
});

test('transient: auth expired is NOT transient', () => {
  expect(isTransient(CoworkErrorKind.AuthExpired)).toBe(false);
});

test('transient: budget exceeded is NOT transient', () => {
  expect(isTransient(CoworkErrorKind.BudgetExceeded)).toBe(false);
});

test('transient: unknown is NOT transient', () => {
  expect(isTransient(CoworkErrorKind.Unknown)).toBe(false);
});

// ─── I18n key mapping ──────────────────────────────────────────────────────

test('i18n: all known kinds have an i18n key', () => {
  const kinds = Object.values(CoworkErrorKind);
  for (const kind of kinds) {
    const key = getUserErrorI18nKey(kind);
    expect(key).toBeTruthy();
    expect(key).toMatch(/^coworkError/);
  }
});

// ─── Factory ────────────────────────────────────────────────────────────────

test('factory: makeCoworkError creates structured error', () => {
  const err = makeCoworkError(CoworkErrorKind.ToolTimeout, 'Tool timed out after 30s', {
    statusCode: 408,
    provider: 'openai',
  });
  expect(err.kind).toBe(CoworkErrorKind.ToolTimeout);
  expect(err.message).toBe('Tool timed out after 30s');
  expect(err.statusCode).toBe(408);
  expect(err.provider).toBe('openai');
});

// ─── Constants ──────────────────────────────────────────────────────────────

test('constants: ENGINE_NOT_READY_CODE is typed literal', () => {
  expect(ENGINE_NOT_READY_CODE).toBe('ENGINE_NOT_READY');
});
