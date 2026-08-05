import type { MarketplaceFit, MarketplaceModel, MarketplaceScore, MarketplaceTaskFilter } from './types';
import type { NvidiaSmiSnapshot, SystemMemorySnapshot } from '../hardware/types';

export const MARKETPLACE_SCORE_VERSION = '2026-08-01-v2';

export type MarketplaceHardwareProfile = {
  totalVramMiB: number;
  freeVramMiB: number;
  gpuCount: number;
  gpuNames: string[];
  systemMemoryMiB: number;
  freeSystemMemoryMiB: number;
  isDualGpu: boolean;
};

export type MarketplaceScoringContext = {
  hardware?: MarketplaceHardwareProfile;
  task?: MarketplaceTaskFilter;
  contextSize?: number;
};

const clamp = (value: number, min = 0, max = 100): number => Math.min(max, Math.max(min, value));

export function createMarketplaceHardwareProfile(
  gpuSnapshot?: NvidiaSmiSnapshot | null,
  memorySnapshot?: SystemMemorySnapshot | null,
): MarketplaceHardwareProfile | undefined {
  if (!gpuSnapshot?.available && !memorySnapshot?.available) return undefined;
  const gpus = gpuSnapshot?.gpus ?? [];
  const totalVramMiB = gpus.reduce((total, gpu) => total + gpu.memoryTotalMiB, 0);
  const freeVramMiB = gpus.reduce((total, gpu) => total + (gpu.memoryFreeMiB ?? gpu.memoryTotalMiB), 0);
  return {
    totalVramMiB,
    freeVramMiB,
    gpuCount: gpus.length,
    gpuNames: gpus.map((gpu) => gpu.name),
    systemMemoryMiB: memorySnapshot?.totalMemoryMiB ?? 0,
    freeSystemMemoryMiB: memorySnapshot?.freeMemoryMiB ?? 0,
    isDualGpu: gpus.length >= 2,
  };
}

function modelFileSizeMiB(model: MarketplaceModel): number | undefined {
  const file = model.files?.find((candidate) => candidate.isRecommended) ?? model.files?.[0];
  if (file?.sizeBytes && file.sizeBytes > 0) {
    const shardGroup = file.path.match(/^(.*?)-?\d{5}-of-\d{5}\.gguf$/i)?.[1];
    if (shardGroup) {
      const totalSizeBytes = model.files
        ?.filter((candidate) => candidate.path.match(/^(.*?)-?\d{5}-of-\d{5}\.gguf$/i)?.[1] === shardGroup)
        .reduce((total, candidate) => total + (candidate.sizeBytes ?? 0), 0);
      if (totalSizeBytes && totalSizeBytes > 0) return totalSizeBytes / 1024 / 1024;
    }
    return file.sizeBytes / 1024 / 1024;
  }
  if (model.parameterCount && model.parameterCount > 0) return model.parameterCount * 512;
  return undefined;
}

function modelRequiredMemory(model: MarketplaceModel, contextSize: number): { vramMiB?: number; systemMiB?: number } {
  const fileMiB = modelFileSizeMiB(model);
  if (!fileMiB) return {};
  const contextMiB = Math.max(256, Math.round(contextSize / 1024) * 256);
  // GGUF weights may be split between VRAM and system memory; reserve headroom for KV cache and runtime buffers.
  return { vramMiB: Math.round(fileMiB * 0.82 + contextMiB), systemMiB: Math.round(fileMiB * 0.28 + contextMiB * 1.2) };
}

function fitModel(model: MarketplaceModel, hardware: MarketplaceHardwareProfile | undefined, contextSize: number): { fit: MarketplaceFit; score: number } {
  const required = modelRequiredMemory(model, contextSize);
  if (!hardware) return { fit: { status: 'unknown', reason: '检测设备后可给出更准确的适配建议。' }, score: 55 };
  if (!required.vramMiB && !required.systemMiB) return { fit: { status: 'unknown', reason: '目录尚未提供 GGUF 文件大小，暂不猜测是否适配。' }, score: 48 };
  // Fit is based on the machine's maximum GPU and system-memory capacity.
  // Current free memory fluctuates with unrelated applications and must not
  // change the catalogue recommendation for the same device.
  const availableVram = hardware.totalVramMiB;
  const availableSystem = hardware.systemMemoryMiB;
  if (hardware.gpuCount === 0) {
    const cpuRequiredMiB = (modelFileSizeMiB(model) ?? 0) * 1.15 + (required.systemMiB ?? 0);
    const cpuRatio = cpuRequiredMiB > 0 ? availableSystem / cpuRequiredMiB : 0;
    const status: MarketplaceFit['status'] = cpuRatio >= 1.05 ? 'limited' : 'unsupported';
    return {
      fit: {
        status,
        estimatedVramMiB: required.vramMiB,
        estimatedSystemMemoryMiB: Math.round(cpuRequiredMiB),
        recommendedContext: status === 'limited' ? Math.min(contextSize, 4096) : 2048,
        reason: status === 'limited'
          ? '未检测到 NVIDIA GPU；系统内存可容纳，预计使用 CPU 或其他本地后端，速度需实测。'
          : '未检测到 NVIDIA GPU，且当前系统内存余量不足以稳妥加载该量化。',
      },
      score: status === 'limited' ? clamp(52 + Math.min(cpuRatio, 1.5) * 12) : clamp(35 + cpuRatio * 15),
    };
  }
  const vramRatio = required.vramMiB ? availableVram / required.vramMiB : 1;
  const systemRatio = required.systemMiB ? availableSystem / required.systemMiB : 1;
  const ratio = Math.min(vramRatio, systemRatio);
  const status: MarketplaceFit['status'] = ratio >= 1.35 ? 'excellent' : ratio >= 1.05 ? 'good' : ratio >= 0.8 ? 'limited' : 'unsupported';
  const reason = status === 'excellent'
    ? '按当前显存与内存余量，适合直接运行。'
    : status === 'good'
      ? '可以运行，建议使用推荐上下文长度。'
      : status === 'limited'
        ? '可以尝试，可能需要降低上下文或使用混合卸载。'
        : '当前设备余量不足，建议选择更小量化。';
  return {
    fit: { status, estimatedVramMiB: required.vramMiB, estimatedSystemMemoryMiB: required.systemMiB, recommendedContext: ratio >= 1.05 ? contextSize : Math.max(2048, Math.floor(contextSize * ratio)), reason },
    score: clamp(50 + ratio * 40),
  };
}

function taskScore(model: MarketplaceModel, task: MarketplaceTaskFilter): number {
  const capabilities = model.capabilities?.length ? model.capabilities : [model.capability];
  if (task === 'all') return capabilities.length ? 76 : 54;
  return capabilities.includes(task as MarketplaceModel['capability'])
    ? 96
    : model.tags.some((tag) => tag.toLowerCase() === task)
      ? 72
      : 42;
}

function confidence(model: MarketplaceModel): MarketplaceScore['confidence'] {
  const evidenceCount = model.evidence?.length ?? 0;
  const hasFileHash = Boolean(model.files?.some((file) => file.sha256));
  if (model.runtime?.status === 'verified' && evidenceCount >= 3 && hasFileHash) return 'A';
  if (evidenceCount >= 2 || hasFileHash) return 'B';
  if (evidenceCount >= 1) return 'C';
  return 'D';
}

function runtimeScore(model: MarketplaceModel): number {
  if (model.runtime?.status === 'verified') return 96;
  if (model.runtime?.status === 'documented' && model.runtime.sha256Verified) return 72;
  if (model.runtime?.status === 'candidate' && model.runtime.ggufFilesVerified) return 62;
  if (model.runtime?.status === 'unsupported') return 0;
  return 35;
}

export function scoreMarketplaceModel(model: MarketplaceModel, context: MarketplaceScoringContext = {}): { score: MarketplaceScore; fit: MarketplaceFit } {
  const taskQuality = taskScore(model, context.task ?? 'all');
  const fitResult = fitModel(model, context.hardware, context.contextSize ?? 8192);
  const runtimeCompatibility = clamp(runtimeScore(model));
  const trust = clamp(model.trustScore ?? (model.licenseStatus === 'permissive' ? 78 : model.licenseStatus === 'restricted' ? 58 : 45));
  const community = clamp(model.communityScore ?? (model.downloads ? 50 + Math.min(45, Math.log10(model.downloads + 1) * 12) : 44));
  const value = clamp(taskQuality * 0.35 + fitResult.score * 0.30 + runtimeCompatibility * 0.15 + trust * 0.10 + community * 0.10);
  const stars = Math.round((value / 20) * 2) / 2;
  const reasons = [
    context.task && context.task !== 'all' ? (taskQuality >= 80 ? `适合${context.task}任务` : '任务匹配度有限') : '综合任务表现',
    fitResult.fit.reason ?? '设备适配信息待补充',
    model.runtime?.status === 'verified'
      ? '端侧加载与最小推理探针已通过'
      : model.runtime?.status === 'documented'
        ? '文件已校验，模型卡声明支持本地运行，仍待端侧探针'
        : '文件已校验，运行兼容性仍待端侧探针',
  ];
  return {
    fit: fitResult.fit,
    score: {
      stars, value: Math.round(value * 10) / 10, confidence: confidence(model), taskQuality: Math.round(taskQuality),
      deviceFit: Math.round(fitResult.score), runtimeCompatibility: Math.round(runtimeCompatibility), trust: Math.round(trust),
      community: Math.round(community), reasons, scoreVersion: MARKETPLACE_SCORE_VERSION,
    },
  };
}

export function withMarketplaceScore(model: MarketplaceModel, context: MarketplaceScoringContext = {}): MarketplaceModel {
  const result = scoreMarketplaceModel(model, context);
  return { ...model, score: result.score, fit: result.fit };
}

export function formatMarketplaceHardwareSummary(hardware?: MarketplaceHardwareProfile): string {
  if (!hardware) return '设备信息不可用';
  const gpu = hardware.gpuCount
    ? `${hardware.gpuCount} GPU · ${Math.round(hardware.totalVramMiB / 1024)}GB 显存`
    : '未检测到GPU';
  const memory = hardware.systemMemoryMiB
    ? `${Math.round(hardware.systemMemoryMiB / 1024)}GB 内存`
    : '系统内存未检测到';
  return `${gpu} · ${memory}`;
}

export function formatMarketplaceStars(stars?: number): string {
  if (!stars || stars <= 0) return '—';
  return stars.toFixed(1);
}
