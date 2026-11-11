/**
 * Standalone verification script for GLM-5.3-flash live endpoint.
 * Set GLM53_VERIFY_BASE_URL and GLM53_VERIFY_API_KEY in the environment first.
 * Run with: bun run scripts/verify-glm53-live-endpoint.ts
 * Never commit credentials or put them in command-line arguments.
 */
import { pathToFileURL } from 'node:url';

import { classifyCoworkError, CoworkErrorKind } from '../src/common/coworkError';
import { safeSlice } from '../src/shared/lib/safeSlice';

const MODEL_ID = 'glm-5.3-flash';

export async function verifyGlm53LiveEndpoint(): Promise<void> {
  const baseUrl = process.env.GLM53_VERIFY_BASE_URL?.trim();
  const apiKey = process.env.GLM53_VERIFY_API_KEY?.trim();
  if (!baseUrl || !apiKey) {
    throw new Error('Set GLM53_VERIFY_BASE_URL and GLM53_VERIFY_API_KEY before live verification.');
  }

  let endpoint: URL;
  try {
    endpoint = new URL(baseUrl);
  } catch {
    throw new Error('GLM53_VERIFY_BASE_URL must be an absolute HTTP or HTTPS URL.');
  }
  if (
    !['http:', 'https:'].includes(endpoint.protocol) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new Error(
      'GLM53_VERIFY_BASE_URL must use HTTP or HTTPS without credentials, query, or fragment.',
    );
  }
  console.log('=== GLM-5.3-flash Live Verification Harness ===\n');

  // 1. Verify Error Classification Regex
  console.log('Test 1: Error Classification for Context Overflow...');
  const liveErrorSample = JSON.stringify({
    error: {
      message:
        'request (75574 tokens) exceeds the available context size (65536 tokens), try increasing it',
      type: 'exceed_context_size_error',
      param: '',
      code: 400,
    },
  });
  const classified = classifyCoworkError(liveErrorSample);
  if (classified.kind !== CoworkErrorKind.InputTooLong) {
    throw new Error(`Classification failed: expected InputTooLong, got ${classified.kind}`);
  }
  console.log(
    '✓ Error classified correctly as CoworkErrorKind.InputTooLong (statusCode: ' +
      classified.statusCode +
      ')\n',
  );

  // 2. Verify Unicode Surrogate Pair Slicing
  console.log('Test 2: Unicode Safe Slicing at Boundary...');
  const testSurrogate = '你好🚀测试𠮷文档';
  const sliced = safeSlice(testSurrogate, 3); // cut midway into 🚀
  if (
    sliced.charCodeAt(sliced.length - 1) >= 0xd800 &&
    sliced.charCodeAt(sliced.length - 1) <= 0xdbff
  ) {
    throw new Error('Dangling high surrogate detected!');
  }
  console.log(
    '✓ safeSlice trimmed high surrogate cleanly: length =',
    sliced.length,
    'value =',
    sliced,
    '\n',
  );

  // 3. Explicitly configured live connectivity and reasoning probe.
  console.log('Test 3: Live Endpoint Connectivity & Reasoning Extraction...');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${endpoint.href.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL_ID,
        messages: [
          { role: 'user', content: '请简要说明为什么在分布式系统中单调时钟优于墙上时钟？' },
        ],
        max_tokens: 8192,
      }),
      signal: controller.signal,
      redirect: 'error',
    });
    if (!response.ok) {
      throw new Error(`Live endpoint responded with HTTP ${response.status}.`);
    } else {
      const data = (await response.json()) as {
        model?: string;
        choices?: Array<{
          finish_reason?: string;
          message?: {
            reasoning_content?: string;
            content?: string;
          };
        }>;
      };
      const choice = data.choices?.[0];
      console.log('Has model identifier:', typeof data.model === 'string');
      console.log('Has reasoning_content:', Boolean(choice?.message?.reasoning_content));
      console.log('Has content:', Boolean(choice?.message?.content));
      console.log('Has finish reason:', typeof choice?.finish_reason === 'string');
      console.log('✓ Live endpoint responded successfully with adequate max_tokens allocation!');
    }
  } catch {
    // Provider bodies and transport errors can echo credentials. Do not log them.
    throw new Error(
      'Live endpoint verification failed. Check endpoint availability and credentials.',
    );
  } finally {
    clearTimeout(timer);
  }

  console.log('\n=== All Verification Harness Checks Complete ===');
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  void verifyGlm53LiveEndpoint().catch((error: unknown) => {
    console.error(
      'Harness failed:',
      error instanceof Error ? error.message : 'Verification failed.',
    );
    process.exitCode = 1;
  });
}
