import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { verifyGlm53LiveEndpoint } from './verify-glm53-live-endpoint';

const TEST_API_KEY = 'test-only-placeholder';
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('GLM53_VERIFY_BASE_URL', 'https://example.invalid/v1/');
  vi.stubEnv('GLM53_VERIFY_API_KEY', TEST_API_KEY);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test.each(['GLM53_VERIFY_BASE_URL', 'GLM53_VERIFY_API_KEY'])(
  'refuses to contact the network without %s',
  async name => {
    vi.stubEnv(name, '   ');
    await expect(verifyGlm53LiveEndpoint()).rejects.toThrow('Set GLM53_VERIFY_BASE_URL');
    expect(fetchMock).not.toHaveBeenCalled();
  },
);

test.each([
  'not-a-url',
  'file:///tmp/model',
  'https://user:password@example.invalid/v1',
  'https://example.invalid/v1?key=placeholder',
  'https://example.invalid/v1#placeholder',
])('rejects unsafe endpoint configuration: %s', async baseUrl => {
  vi.stubEnv('GLM53_VERIFY_BASE_URL', baseUrl);
  await expect(verifyGlm53LiveEndpoint()).rejects.toThrow('GLM53_VERIFY_BASE_URL');
  expect(fetchMock).not.toHaveBeenCalled();
});

test('uses only the explicit configuration and refuses redirects', async () => {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] })),
  );

  await verifyGlm53LiveEndpoint();

  expect(fetchMock).toHaveBeenCalledOnce();
  expect(fetchMock).toHaveBeenCalledWith(
    'https://example.invalid/v1/chat/completions',
    expect.objectContaining({
      method: 'POST',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_API_KEY}`,
      },
    }),
  );
  expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain(TEST_API_KEY);
});

test('fails on HTTP errors without reading or logging the response body', async () => {
  const response = new Response(TEST_API_KEY, { status: 401 });
  const readBody = vi.spyOn(response, 'text');
  fetchMock.mockResolvedValue(response);
  const clearTimer = vi.spyOn(globalThis, 'clearTimeout');

  await expect(verifyGlm53LiveEndpoint()).rejects.toThrow('Live endpoint verification failed.');
  expect(readBody).not.toHaveBeenCalled();
  expect(clearTimer).toHaveBeenCalledOnce();
  expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain(TEST_API_KEY);
});

test('does not log provider-controlled response fields', async () => {
  fetchMock.mockResolvedValue(
    new Response(
      JSON.stringify({
        model: TEST_API_KEY,
        choices: [{ finish_reason: TEST_API_KEY, message: { content: TEST_API_KEY } }],
      }),
    ),
  );

  await verifyGlm53LiveEndpoint();

  expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain(TEST_API_KEY);
});

test('fails on malformed JSON without logging the response content', async () => {
  fetchMock.mockResolvedValue(new Response(TEST_API_KEY));

  await expect(verifyGlm53LiveEndpoint()).rejects.toThrow('Live endpoint verification failed.');
  expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain(TEST_API_KEY);
});

test('fails on transport errors without exposing their details or claiming success', async () => {
  fetchMock.mockRejectedValue(new Error(`request rejected: ${TEST_API_KEY}`));
  const clearTimer = vi.spyOn(globalThis, 'clearTimeout');

  await expect(verifyGlm53LiveEndpoint()).rejects.toThrow('Live endpoint verification failed.');
  expect(clearTimer).toHaveBeenCalledOnce();
  const output = JSON.stringify(vi.mocked(console.log).mock.calls);
  expect(output).not.toContain(TEST_API_KEY);
  expect(output).not.toContain('All Verification Harness Checks Complete');
});
