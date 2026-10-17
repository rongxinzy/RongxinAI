// Exported llama.cpp IPC helper routines (#1069).
import type { NvidiaSmiSnapshot } from '../../../shared/hardware';
import {
  DEFAULT_LLAMACPP_SERVICE_CONFIG,
  getLlamaCppModelsMaxLimitViolation,
  LlamaCppIpcChannel,
} from '../../../shared/llamacpp';
import type { ModelCapabilities } from '../../../shared/providers';
import { t } from '../../i18n';
import type { LlamaCppManager } from '../../libs/llamacppManager';
import {
  classifyLlamaCppModelLoadError,
  getLlamaCppModelLoadFailureI18nKey,
} from '../../libs/llamacppModelLoadErrors';
import type { LlamaCppModelResidencySnapshot } from '../../libs/llamacppModelResidencyManager';

const LLAMACPP_UNLOAD_CONFIRM_TIMEOUT_MS = 8_000;
const LLAMACPP_UNLOAD_CONFIRM_POLL_INTERVAL_MS = 400;
const LLAMACPP_UNLOAD_CONFIRM_STABLE_MISSING_POLLS = 2;
const LLAMACPP_STARTUP_BINDING_SYNC_ATTEMPTS = 30;
const LLAMACPP_STARTUP_BINDING_SYNC_INTERVAL_MS = 1_000;

export function broadcastLlamaCppModelResidencyState(
  broadcast: (channel: string, payload: unknown) => void,
  snapshot: LlamaCppModelResidencySnapshot,
): void {
  broadcast(LlamaCppIpcChannel.ModelResidencyChanged, snapshot);
}

export async function waitForLlamaCppStartupModelBindings(input: {
  refresh: () => Promise<boolean>;
  isCurrent: () => boolean;
  attempts?: number;
  intervalMs?: number;
  wait?: (delayMs: number) => Promise<void>;
}): Promise<void> {
  const attempts = Math.max(1, input.attempts ?? LLAMACPP_STARTUP_BINDING_SYNC_ATTEMPTS);
  const intervalMs = input.intervalMs ?? LLAMACPP_STARTUP_BINDING_SYNC_INTERVAL_MS;
  const wait = input.wait ?? (delayMs => new Promise(resolve => setTimeout(resolve, delayMs)));

  for (let attempt = 0; attempt < attempts && input.isCurrent(); attempt += 1) {
    if (await input.refresh()) return;
    if (attempt < attempts - 1 && input.isCurrent()) {
      await wait(intervalMs);
    }
  }
}

export const LLAMACPP_SANITIZED_NUMERIC_DEFAULTS = {
  modelsMax: DEFAULT_LLAMACPP_SERVICE_CONFIG.modelsMax ?? '0',
  timeout: DEFAULT_LLAMACPP_SERVICE_CONFIG.timeout ?? '120',
  threadsHttp: DEFAULT_LLAMACPP_SERVICE_CONFIG.threadsHttp ?? '4',
  cacheReuse: DEFAULT_LLAMACPP_SERVICE_CONFIG.cacheReuse ?? '256',
  cacheRam: DEFAULT_LLAMACPP_SERVICE_CONFIG.cacheRam ?? '8192',
  ctxSize: DEFAULT_LLAMACPP_SERVICE_CONFIG.ctxSize ?? '4096',
  parallel: DEFAULT_LLAMACPP_SERVICE_CONFIG.parallel ?? '2',
  batchSize: DEFAULT_LLAMACPP_SERVICE_CONFIG.batchSize ?? '512',
  ubatchSize: DEFAULT_LLAMACPP_SERVICE_CONFIG.ubatchSize ?? '512',
  gpuLayers: DEFAULT_LLAMACPP_SERVICE_CONFIG.gpuLayers ?? 'auto',
  threads: DEFAULT_LLAMACPP_SERVICE_CONFIG.threads ?? '-1',
  threadsBatch: DEFAULT_LLAMACPP_SERVICE_CONFIG.threadsBatch ?? '-1',
  mainGpu: DEFAULT_LLAMACPP_SERVICE_CONFIG.mainGpu ?? '0',
} as const;

export const LLAMACPP_MEMORY_BUDGET_PERCENT_RANGE = { min: 10, max: 90 } as const;

export type LlamaCppModelBindingRefreshResult = {
  changed: boolean;
  hasRunningModels: boolean;
};

export const LLAMACPP_MODEL_PREFERENCE_CAPABILITY_KEYS = [
  'toolCalling',
  'imageInput',
  'videoInput',
  'audioInput',
  'documentInput',
  'reasoning',
] as const satisfies ReadonlyArray<keyof ModelCapabilities>;

export function getLlamaCppLoadedModelLimitViolation(input: {
  modelsMax: string | undefined;
  runningModels: Array<{ name?: string; model?: string }>;
  targetModelName: string;
}): { limit: number; next: number } | null {
  return getLlamaCppModelsMaxLimitViolation({
    modelsMax: input.modelsMax,
    targetModelName: input.targetModelName,
    runningModelNames: Array.from(
      new Set(
        input.runningModels.map(model => (model.name || model.model || '').trim()).filter(Boolean),
      ),
    ),
  });
}

export function getTotalFreeVramMiB(snapshot: NvidiaSmiSnapshot | null | undefined): number | null {
  if (!snapshot?.available || snapshot.gpus.length === 0) return null;
  const values = snapshot.gpus
    .map(gpu => gpu.memoryFreeMiB)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0);
}

export function getRequiredVramRecoveryMiB(sizeVramBytes?: number): number | null {
  if (!Number.isFinite(sizeVramBytes) || !sizeVramBytes || sizeVramBytes <= 0) return null;
  const sizeVramMiB = sizeVramBytes / (1024 * 1024);
  return Math.max(64, Math.min(512, Math.round(sizeVramMiB * 0.25)));
}

export function hasRecoveredVram(input: {
  beforeSnapshot: NvidiaSmiSnapshot | null | undefined;
  currentSnapshot: NvidiaSmiSnapshot | null | undefined;
  sizeVramBytes?: number;
}): boolean {
  const beforeFreeMiB = getTotalFreeVramMiB(input.beforeSnapshot);
  const currentFreeMiB = getTotalFreeVramMiB(input.currentSnapshot);
  const requiredRecoveryMiB = getRequiredVramRecoveryMiB(input.sizeVramBytes);
  if (beforeFreeMiB === null || currentFreeMiB === null || requiredRecoveryMiB === null) {
    return false;
  }
  return currentFreeMiB - beforeFreeMiB >= requiredRecoveryMiB;
}

function matchesRunningModelName(
  model: { name?: string; model?: string; id?: string },
  modelName: string,
): boolean {
  return model.name === modelName || model.model === modelName || model.id === modelName;
}

export function toUserFacingLlamaCppModelLoadError(error: unknown): Error {
  const reason = classifyLlamaCppModelLoadError(error);
  return new Error(t(getLlamaCppModelLoadFailureI18nKey(reason)));
}

export function throwIfLlamaCppModelLoadCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
}

export async function waitForLlamaCppModelUnloadConfirmation(input: {
  modelName: string;
  listRunningModels: () => Promise<Awaited<ReturnType<LlamaCppManager['listRunningModels']>>>;
  timeoutMs?: number;
  intervalMs?: number;
  stableMissingPolls?: number;
}): Promise<{
  confirmed: boolean;
  runningModels: Awaited<ReturnType<LlamaCppManager['listRunningModels']>>;
}> {
  const timeoutMs = input.timeoutMs ?? LLAMACPP_UNLOAD_CONFIRM_TIMEOUT_MS;
  const intervalMs = input.intervalMs ?? LLAMACPP_UNLOAD_CONFIRM_POLL_INTERVAL_MS;
  const stableMissingPolls = Math.max(
    1,
    input.stableMissingPolls ?? LLAMACPP_UNLOAD_CONFIRM_STABLE_MISSING_POLLS,
  );
  const deadline = Date.now() + timeoutMs;
  let latestRunningModels = await input.listRunningModels();
  let missingPolls = latestRunningModels.some(model =>
    matchesRunningModelName(model, input.modelName),
  )
    ? 0
    : 1;

  if (missingPolls >= stableMissingPolls) {
    return { confirmed: true, runningModels: latestRunningModels };
  }

  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, intervalMs));
    latestRunningModels = await input.listRunningModels();
    if (latestRunningModels.some(model => matchesRunningModelName(model, input.modelName))) {
      missingPolls = 0;
      continue;
    }
    missingPolls += 1;
    if (missingPolls >= stableMissingPolls) {
      return { confirmed: true, runningModels: latestRunningModels };
    }
  }

  return {
    confirmed: false,
    runningModels: latestRunningModels,
  };
}
