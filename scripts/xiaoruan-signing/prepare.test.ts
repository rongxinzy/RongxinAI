import { expect, test } from 'vitest';
import { prepareXiaoruanSigning } from './prepare.mjs';

test('accepts a successful Xiaoruan main windows-build run', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes('/actions/runs/35979555619/jobs')) {
      return {
        ok: true,
        json: async () => ({
          jobs: [
            {
              name: 'build-platforms',
              steps: [
                { name: 'Build Windows', conclusion: 'success' },
                {
                  name: 'Verify Windows package runtimes with a clean PATH',
                  conclusion: 'success',
                },
                { name: 'Run actions/upload-artifact@v6', conclusion: 'success' },
              ],
            },
          ],
        }),
      };
    }
    if (String(url).includes('/actions/runs/35979555619/artifacts')) {
      return {
        ok: true,
        json: async () => ({
          artifacts: [{ id: 10800275783, name: 'windows-build', expired: false }],
        }),
      };
    }
    if (String(url).endsWith('/actions/runs/35979555619')) {
      return {
        ok: true,
        json: async () => ({
          id: 35979555619,
          repository: { full_name: 'rongxinzy/xiaoruan-ai-agent' },
          head_repository: { full_name: 'rongxinzy/xiaoruan-ai-agent' },
          path: '.github/workflows/build-platforms.yml',
          event: 'workflow_dispatch',
          head_branch: 'main',
          status: 'completed',
          conclusion: 'success',
          head_sha: 'a80fa00cd1f6a1343a515154bad0ec7a491aa5bc',
        }),
      };
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  try {
    const result = await prepareXiaoruanSigning({
      SOURCE_RUN_ID: '35979555619',
      RUNTIME_ARTIFACT_READ_TOKEN: 'test-token',
    });
    expect(result).toEqual({
      sourceRepository: 'rongxinzy/xiaoruan-ai-agent',
      sourceRunId: '35979555619',
      sourceSha: 'a80fa00cd1f6a1343a515154bad0ec7a491aa5bc',
      artifact: 'windows-build',
      artifactId: '10800275783',
    });
    expect(calls.length).toBe(3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rejects a non-main source run', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      id: 1,
      repository: { full_name: 'rongxinzy/xiaoruan-ai-agent' },
      head_repository: { full_name: 'rongxinzy/xiaoruan-ai-agent' },
      path: '.github/workflows/build-platforms.yml',
      event: 'workflow_dispatch',
      head_branch: 'feat/dev-lisa',
      status: 'completed',
      conclusion: 'success',
      head_sha: 'a80fa00cd1f6a1343a515154bad0ec7a491aa5bc',
    }),
  });
  try {
    await expect(
      prepareXiaoruanSigning({
        SOURCE_RUN_ID: '1',
        RUNTIME_ARTIFACT_READ_TOKEN: 'test-token',
      }),
    ).rejects.toThrow(/successful Xiaoruan main/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
