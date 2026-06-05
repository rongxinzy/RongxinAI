import path from 'path';
import { describe, expect, test } from 'vitest';

const scriptPath = path.resolve(process.cwd(), 'scripts', 'mirror-llamacpp-runtime-gitee.cjs');
const {
  buildMirrorPlan,
  parseArgs,
  resolveTargets,
} = require(scriptPath) as {
  buildMirrorPlan: (
    rootDir: string,
    options: {
      targets: string[];
      tag?: string;
      githubRepo?: string;
      outputDir?: string;
      giteeOwner: string;
      giteeRepo: string;
      giteeApiBase: string;
    },
  ) => {
    tag: string;
    githubRepo: string;
    outputDir: string;
    giteeOwner: string;
    giteeRepo: string;
    assets: Array<{
      targetId: string;
      assetName: string;
      upstreamUrl: string;
      localPath: string;
    }>;
  };
  parseArgs: (argv: string[]) => {
    targets: string[];
    upload: boolean;
    dryRun: boolean;
    giteeOwner: string;
    giteeRepo: string;
  };
  resolveTargets: (rootDir: string, requestedTargets: string[]) => string[];
};

describe('llamacpp runtime Gitee mirror script', () => {
  test('parses target and upload arguments', () => {
    expect(parseArgs([
      '--targets',
      'win-x64,win-x64-cuda-12',
      '--upload',
      '--dry-run',
      '--gitee-owner',
      'owner',
      '--gitee-repo',
      'repo',
    ])).toEqual(expect.objectContaining({
      targets: ['win-x64', 'win-x64-cuda-12'],
      upload: true,
      dryRun: true,
      giteeOwner: 'owner',
      giteeRepo: 'repo',
    }));
  });

  test('resolves all package runtime targets', () => {
    expect(resolveTargets(process.cwd(), ['all'])).toEqual([
      'mac-arm64',
      'mac-x64',
      'win-x64',
      'win-x64-cuda-12',
      'win-arm64',
      'linux-x64',
      'linux-arm64',
    ]);
  });

  test('builds a GitHub-to-Gitee mirror plan for CUDA 12 runtime assets', () => {
    const plan = buildMirrorPlan(process.cwd(), {
      targets: ['win-x64-cuda-12'],
      tag: 'b9505',
      githubRepo: 'ggml-org/llama.cpp',
      outputDir: '/tmp/llamacpp-mirror',
      giteeOwner: 'wanghaozhe1106',
      giteeRepo: 'llama.cpp-runtime',
      giteeApiBase: 'https://gitee.com/api/v5',
    });

    expect(plan).toEqual(expect.objectContaining({
      tag: 'b9505',
      githubRepo: 'ggml-org/llama.cpp',
      outputDir: '/tmp/llamacpp-mirror',
      giteeOwner: 'wanghaozhe1106',
      giteeRepo: 'llama.cpp-runtime',
    }));
    expect(plan.assets).toEqual([
      {
        targetId: 'win-x64-cuda-12',
        role: 'runtime',
        assetName: 'llama-b9505-bin-win-cuda-12.4-x64.tar.gz',
        upstreamUrl:
          'https://github.com/ggml-org/llama.cpp/releases/download/b9505/llama-b9505-bin-win-cuda-12.4-x64.tar.gz',
        localPath: '/tmp/llamacpp-mirror/llama-b9505-bin-win-cuda-12.4-x64.tar.gz',
      },
      {
        targetId: 'win-x64-cuda-12',
        role: 'companion',
        assetName: 'cudart-llama-bin-win-cuda-12.4-x64.tar.gz',
        upstreamUrl:
          'https://github.com/ggml-org/llama.cpp/releases/download/b9505/cudart-llama-bin-win-cuda-12.4-x64.tar.gz',
        localPath: '/tmp/llamacpp-mirror/cudart-llama-bin-win-cuda-12.4-x64.tar.gz',
      },
    ]);
  });
});
