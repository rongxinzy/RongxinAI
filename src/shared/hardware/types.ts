import { z } from 'zod';

const NvidiaGpuInfoSchema = z.object({
  index: z.number(),
  name: z.string(),
  memoryTotalMiB: z.number(),
  memoryFreeMiB: z.number().optional(),
  driverVersion: z.string().optional(),
  /** NVIDIA compute capability major.minor (e.g. 8.9 for RTX 40 series). */
  computeCapability: z.string().optional(),
});

export const NvidiaSmiSnapshotSchema = z.object({
  source: z.literal('nvidia-smi'),
  available: z.boolean(),
  checkedAt: z.string(),
  gpus: z.array(NvidiaGpuInfoSchema),
  /** Driver version from the first GPU row, when available. */
  driverVersion: z.string().optional(),
  error: z.string().optional(),
});

export const SystemMemorySnapshotSchema = z.object({
  source: z.literal('system'),
  available: z.boolean(),
  checkedAt: z.string(),
  totalMemoryMiB: z.number(),
  freeMemoryMiB: z.number(),
  error: z.string().optional(),
});

export type NvidiaGpuInfo = z.infer<typeof NvidiaGpuInfoSchema>;
export type NvidiaSmiSnapshot = z.infer<typeof NvidiaSmiSnapshotSchema>;
export type SystemMemorySnapshot = z.infer<typeof SystemMemorySnapshotSchema>;
