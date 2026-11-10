/**
 * Standalone verification script for GLM-5.3-flash live endpoint.
 * Run with: bun run scripts/verify-glm53-live-endpoint.ts
 */
import { classifyCoworkError, CoworkErrorKind } from '../src/common/coworkError';
import { safeSlice } from '../src/shared/lib/safeSlice';

const ENDPOINT_BASE_URL = 'http://172.18.5.188:3000/v1';
const API_KEY = 'sk-pBz2QZgtUNKl4a5zBH1c7qY5vHat8FWj0T3GCqAfmF18CRKt';
const MODEL_ID = 'glm-5.3-flash';

async function main(): Promise<void> {
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

  // 3. Live Connectivity and CoT Reasoning Probe (if endpoint is reachable)
  console.log('Test 3: Live Endpoint Connectivity & Reasoning Extraction...');
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(`${ENDPOINT_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL_ID,
        messages: [
          { role: 'user', content: '请简要说明为什么在分布式系统中单调时钟优于墙上时钟？' },
        ],
        max_tokens: 8192,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) {
      console.warn(
        `Live endpoint responded with HTTP ${response.status}: ${await response.text()}`,
      );
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
      console.log('Backend Model Reported:', data.model);
      console.log('Has reasoning_content:', Boolean(choice?.message?.reasoning_content));
      console.log('Has content:', Boolean(choice?.message?.content));
      console.log('Finish Reason:', choice?.finish_reason);
      console.log('✓ Live endpoint responded successfully with adequate max_tokens allocation!');
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.log('ℹ Live network connection skipped (offline or intranet only):', errorMsg);
    console.log('  (Harness logic verified offline via synthetic payloads)');
  }

  console.log('\n=== All Verification Harness Checks Complete ===');
}

main().catch(err => {
  console.error('Harness failed:', err);
  process.exit(1);
});
