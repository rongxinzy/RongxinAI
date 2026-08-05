import { describe, expect, it } from 'vitest';

import type { NvidiaSmiSnapshot, SystemMemorySnapshot } from '../hardware';
import {
  createMarketplaceHardwareProfile,
  formatMarketplaceHardwareSummary,
  scoreMarketplaceModel,
} from './scoring';
import type { MarketplaceModel } from './types';

const model: MarketplaceModel = {
  source: 'modelscope-gguf', id: 'demo/Qwen-7B-GGUF', repoId: 'demo/Qwen-7B-GGUF', name: 'Qwen 7B',
  description: '', tags: ['chat'], sizes: ['desktop'], recommendedTag: 'Q4_K_M', capability: 'chat',
  filePath: 'qwen-7b-q4_k_m.gguf', installed: false,
  files: [{ path: 'qwen-7b-q4_k_m.gguf', sizeBytes: 4 * 1024 ** 3, sha256: 'abc', isRecommended: true }],
  evidence: [{ source: 'ModelScope', kind: 'modelscope', label: 'files', confidence: 'A' }],
};

const gpuSnapshot: NvidiaSmiSnapshot = {
  source: 'nvidia-smi', available: true, checkedAt: new Date().toISOString(),
  gpus: [
    { index: 0, name: 'RTX 4060', memoryTotalMiB: 8192, memoryFreeMiB: 7000 },
    { index: 1, name: 'RTX 4060', memoryTotalMiB: 8192, memoryFreeMiB: 7000 },
  ],
};

const memorySnapshot: SystemMemorySnapshot = {
  source: 'system', available: true, checkedAt: new Date().toISOString(), totalMemoryMiB: 65536, freeMemoryMiB: 48000,
};

describe('marketplace device scoring', () => {
  it('recognizes a dual 4060 / 64GB profile', () => {
    const profile = createMarketplaceHardwareProfile(gpuSnapshot, memorySnapshot);
    expect(profile?.isDualGpu).toBe(true);
    expect(profile?.totalVramMiB).toBe(16384);
    expect(profile?.systemMemoryMiB).toBe(65536);
  });

  it('formats hardware capacity separately from current free memory', () => {
    const profile = createMarketplaceHardwareProfile(gpuSnapshot, memorySnapshot);
    expect(formatMarketplaceHardwareSummary(profile)).toBe('2 GPU · 16GB 显存 · 64GB 内存');
  });

  it('does not render an unavailable GPU probe as zero capacity', () => {
    const profile = createMarketplaceHardwareProfile(
      { source: 'nvidia-smi', available: false, checkedAt: new Date().toISOString(), gpus: [] },
      memorySnapshot,
    );
    expect(formatMarketplaceHardwareSummary(profile)).toBe('未检测到GPU · 64GB 内存');
  });

  it('keeps a memory-resident CPU fallback limited instead of claiming GPU-quality fit or no support', () => {
    const profile = createMarketplaceHardwareProfile(
      { source: 'nvidia-smi', available: false, checkedAt: new Date().toISOString(), gpus: [] },
      memorySnapshot,
    );
    const result = scoreMarketplaceModel(model, { hardware: profile, task: 'chat' });
    expect(result.fit.status).toBe('limited');
    expect(result.fit.reason).toContain('CPU');
  });

  it('sums split GGUF shards before deciding CPU fit', () => {
    const profile = createMarketplaceHardwareProfile(
      { source: 'nvidia-smi', available: false, checkedAt: new Date().toISOString(), gpus: [] },
      { source: 'system', available: true, checkedAt: new Date().toISOString(), totalMemoryMiB: 16 * 1024, freeMemoryMiB: 16 * 1024 },
    );
    const splitModel: MarketplaceModel = {
      ...model,
      files: Array.from({ length: 5 }, (_, index) => ({
        path: `glm-0000${index + 1}-of-00005.gguf`,
        sizeBytes: Math.round((169.2 * 1024 ** 3) / 5),
        isRecommended: index === 0,
      })),
    };
    const result = scoreMarketplaceModel(splitModel, { hardware: profile });
    expect(result.fit.status).toBe('unsupported');
  });

  it('provides evidence-backed stars and fit status', () => {
    const profile = createMarketplaceHardwareProfile(gpuSnapshot, memorySnapshot);
    const result = scoreMarketplaceModel(model, { hardware: profile, task: 'chat' });
    expect(result.score.stars).toBeGreaterThanOrEqual(3.5);
    expect(result.score.confidence).toBe('B');
    expect(['excellent', 'good', 'limited']).toContain(result.fit.status);
  });

  it('uses maximum GPU and system-memory capacity instead of current free memory', () => {
    const constrainedSnapshot: NvidiaSmiSnapshot = {
      ...gpuSnapshot,
      gpus: gpuSnapshot.gpus.map(gpu => ({ ...gpu, memoryFreeMiB: 1_024 })),
    };
    const constrainedMemory: SystemMemorySnapshot = {
      ...memorySnapshot,
      freeMemoryMiB: 2_048,
    };
    const profile = createMarketplaceHardwareProfile(constrainedSnapshot, constrainedMemory);
    const result = scoreMarketplaceModel(model, { hardware: profile, task: 'chat' });

    expect(result.fit.status).toBe('excellent');
  });

  it('does not guess fit when catalog file size is unknown', () => {
    const profile = createMarketplaceHardwareProfile(gpuSnapshot, memorySnapshot);
    const result = scoreMarketplaceModel({ ...model, files: [], filePath: undefined }, { hardware: profile });
    expect(result.fit.status).toBe('unknown');
  });
});
