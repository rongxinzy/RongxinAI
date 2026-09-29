import { expect, test } from 'vitest';
import { prepareEnterpriseSigning } from './prepare.mjs';

const SUCCESSFUL_RUN = {
  id: 35979555620,
  repository: { full_name: 'rongxinzy/zhiyuanAaaS' },
  head_repository: { full_name: 'rongxinzy/zhiyuanAaaS' },
  path: '.github/workflows/package-windows.yml',
  event: 'workflow_dispatch',
  head_branch: 'main',
  status: 'completed',
  conclusion: 'success',
  head_sha: '22bce6c22bce6c22bce6c22bce6c22bce6c22bce',
};

const SUCCESSFUL_JOB = {
  name: 'package-and-install',
  steps: [
    { name: 'Build enterprise installer', conclusion: 'success' },
    { name: 'Verify packaged enterprise version', conclusion: 'success' },
    { name: 'Verify injected enterprise package', conclusion: 'success' },
    { name: 'Verify packaged runtimes', conclusion: 'success' },
    { name: 'Upload enterprise installer', conclusion: 'success' },
  ],
};

const WINDOWS_ARTIFACT = {
  id: 10800275784,
  name: 'zhiyuan-enterprise-windows-1.0.0-42',
  expired: false,
};

function jsonResponse(body: unknown) {
  return {
    ok: true,
    json: async () => body,
  };
}

function mockProvenance(overrides: { run?: object; job?: object; artifacts?: object[] } = {}) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    const href = String(url);
    if (href.includes('/actions/runs/35979555620/jobs')) {
      return jsonResponse({ jobs: [overrides.job ?? SUCCESSFUL_JOB] });
    }
    if (href.includes('/actions/runs/35979555620/artifacts')) {
      return jsonResponse({ artifacts: overrides.artifacts ?? [WINDOWS_ARTIFACT] });
    }
    if (href.endsWith('/actions/runs/35979555620')) {
      return jsonResponse(overrides.run ?? SUCCESSFUL_RUN);
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test('accepts a successful Zhiyuan Enterprise package run and resolves an explicit version', async () => {
  const restore = mockProvenance();
  try {
    const result = await prepareEnterpriseSigning({
      SOURCE_RUN_ID: '35979555620',
      RELEASE_VERSION: '1.0.0',
      RUNTIME_ARTIFACT_READ_TOKEN: 'test-token',
    });
    expect(result).toEqual({
      sourceRepository: 'rongxinzy/zhiyuanAaaS',
      sourceRunId: '35979555620',
      sourceSha: '22bce6c22bce6c22bce6c22bce6c22bce6c22bce',
      packageVersion: '1.0.0',
    });
  } finally {
    restore();
  }
});

test('resolves the package version from the unsigned artifact when release_version is empty', async () => {
  const restore = mockProvenance();
  try {
    const result = await prepareEnterpriseSigning({
      SOURCE_RUN_ID: '35979555620',
      RELEASE_VERSION: '',
      RUNTIME_ARTIFACT_READ_TOKEN: 'test-token',
    });
    expect(result.packageVersion).toBe('1.0.0');
  } finally {
    restore();
  }
});

test('rejects an explicit version that does not match the unsigned artifact', async () => {
  const restore = mockProvenance();
  try {
    await expect(
      prepareEnterpriseSigning({
        SOURCE_RUN_ID: '35979555620',
        RELEASE_VERSION: '1.0.1',
        RUNTIME_ARTIFACT_READ_TOKEN: 'test-token',
      }),
    ).rejects.toThrow(/does not match the unsigned build artifact version/);
  } finally {
    restore();
  }
});

test('rejects a failed source run', async () => {
  const restore = mockProvenance({
    run: { ...SUCCESSFUL_RUN, conclusion: 'failure' },
  });
  try {
    await expect(
      prepareEnterpriseSigning({
        SOURCE_RUN_ID: '35979555620',
        RELEASE_VERSION: '1.0.0',
        RUNTIME_ARTIFACT_READ_TOKEN: 'test-token',
      }),
    ).rejects.toThrow(/successful Zhiyuan Enterprise/);
  } finally {
    restore();
  }
});

test('rejects a run without the unexpired enterprise windows artifact', async () => {
  const restore = mockProvenance({
    artifacts: [
      { id: 10800275785, name: 'zhiyuan-enterprise-windows-diagnostics-1.0.0-42', expired: false },
    ],
  });
  try {
    await expect(
      prepareEnterpriseSigning({
        SOURCE_RUN_ID: '35979555620',
        RELEASE_VERSION: '',
        RUNTIME_ARTIFACT_READ_TOKEN: 'test-token',
      }),
    ).rejects.toThrow(/unexpired zhiyuan-enterprise-windows artifact/);
  } finally {
    restore();
  }
});
