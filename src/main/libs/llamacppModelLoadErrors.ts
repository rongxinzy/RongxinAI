export const LlamaCppModelLoadFailureReason = {
  ModelsLimitReached: 'models_limit_reached',
  GpuNotFound: 'gpu_not_found',
  GpuProbeFailed: 'gpu_probe_failed',
  VramInsufficient: 'vram_insufficient',
  SystemMemoryInsufficient: 'system_memory_insufficient',
  ContextTooLarge: 'context_too_large',
  ModelFileInvalid: 'model_file_invalid',
  ModelNotFound: 'model_not_found',
  ServiceUnavailable: 'service_unavailable',
  StartupTimeout: 'startup_timeout',
  Unknown: 'unknown',
} as const;

export type LlamaCppModelLoadFailureReason =
  typeof LlamaCppModelLoadFailureReason[keyof typeof LlamaCppModelLoadFailureReason];

export class LlamaCppModelLoadError extends Error {
  readonly reason: LlamaCppModelLoadFailureReason;
  readonly detail?: string;

  constructor(input: {
    reason: LlamaCppModelLoadFailureReason;
    message?: string;
    detail?: string;
  }) {
    super(input.message ?? input.detail ?? input.reason);
    this.name = 'LlamaCppModelLoadError';
    this.reason = input.reason;
    this.detail = input.detail;
    Object.setPrototypeOf(this, LlamaCppModelLoadError.prototype);
  }
}

const modelLimitPatterns = [
  /model.*(?:limit|maximum|max).*(?:reached|exceeded)/i,
  /(?:loaded|running).*model.*limit/i,
  /models-max/i,
  /too many.*models/i,
];

const gpuProbeFailedPatterns = [
  /nvidia-smi.*(?:failed|timed out|timeout|not found|enoent)/i,
  /gpu.*(?:probe|detect|detection|query).*(?:failed|timed out|timeout|error)/i,
  /(?:probe|detect|detection|query).*gpu.*(?:failed|timed out|timeout|error)/i,
  /cuda.*driver.*(?:failed|error|not initialized)/i,
];

const gpuNotFoundPatterns = [
  /no cuda-capable device/i,
  /no compatible gpu/i,
  /no available gpu/i,
  /no gpu(?:s)? (?:found|detected|available)/i,
  /gpu(?:s)? (?:not found|not detected|unavailable)/i,
  /cuda.*(?:no device|device not found|not available)/i,
];

const vramInsufficientPatterns = [
  /cuda.*out of memory/i,
  /out of memory.*cuda/i,
  /out of memory.*(?:gpu|vram)/i,
  /(?:gpu|vram).*out of memory/i,
  /not enough.*(?:gpu memory|vram|video memory)/i,
  /failed to allocate.*(?:cuda|gpu|vram|device memory)/i,
  /(?:cuda|gpu|vram).*allocation.*failed/i,
];

const systemMemoryInsufficientPatterns = [
  /std::bad_alloc/i,
  /bad allocation/i,
  /out of memory/i,
  /not enough memory/i,
  /cannot allocate memory/i,
  /failed to allocate.*(?:ram|host|system|cpu)/i,
  /mmap.*(?:failed|cannot|could not)/i,
];

const contextTooLargePatterns = [
  /context.*(?:too large|exceeds|exceeded|overflow|unsupported)/i,
  /ctx(?:-size|_size| size)?.*(?:too large|exceeds|exceeded|overflow|unsupported)/i,
  /n_ctx.*(?:too large|exceeds|exceeded|overflow|unsupported)/i,
  /kv cache.*(?:too large|failed|cannot allocate)/i,
];

const modelNotFoundPatterns = [
  /model.*(?:not found|missing|does not exist)/i,
  /file.*(?:not found|missing|does not exist)/i,
  /no such file/i,
  /\benoent\b/i,
];

const modelFileInvalidPatterns = [
  /invalid.*(?:model|gguf|file)/i,
  /corrupt(?:ed)?.*(?:model|gguf|file)/i,
  /failed to load model/i,
  /unable to load model/i,
  /unknown model architecture/i,
  /invalid magic/i,
  /tensor.*(?:missing|not found|invalid)/i,
];

const startupTimeoutPatterns = [
  /startup.*(?:timeout|timed out)/i,
  /load(?:ing)?.*(?:timeout|timed out)/i,
  /did not become ready before timeout/i,
];

const serviceUnavailablePatterns = [
  /(?:econnrefused|ecanceled|econnreset|socket hang up)/i,
  /fetch failed/i,
  /service.*(?:unavailable|not running|stopped|down|exited)/i,
  /llama\.cpp.*(?:unavailable|not running|stopped|down|exited)/i,
  /health.*(?:failed|unavailable)/i,
];

// Keep classifier output stable so orchestration can map technical errors to concise user messages.
export function classifyLlamaCppModelLoadError(
  error: unknown,
): LlamaCppModelLoadFailureReason {
  if (error instanceof LlamaCppModelLoadError) {
    return error.reason;
  }

  const text = normalizeErrorText(error);
  if (!text) return LlamaCppModelLoadFailureReason.Unknown;

  if (matchesAny(text, modelLimitPatterns)) {
    return LlamaCppModelLoadFailureReason.ModelsLimitReached;
  }
  if (matchesAny(text, gpuProbeFailedPatterns)) {
    return LlamaCppModelLoadFailureReason.GpuProbeFailed;
  }
  if (matchesAny(text, gpuNotFoundPatterns)) {
    return LlamaCppModelLoadFailureReason.GpuNotFound;
  }
  if (matchesAny(text, vramInsufficientPatterns)) {
    return LlamaCppModelLoadFailureReason.VramInsufficient;
  }
  if (matchesAny(text, systemMemoryInsufficientPatterns)) {
    return LlamaCppModelLoadFailureReason.SystemMemoryInsufficient;
  }
  if (matchesAny(text, contextTooLargePatterns)) {
    return LlamaCppModelLoadFailureReason.ContextTooLarge;
  }
  if (matchesAny(text, modelNotFoundPatterns)) {
    return LlamaCppModelLoadFailureReason.ModelNotFound;
  }
  if (matchesAny(text, modelFileInvalidPatterns)) {
    return LlamaCppModelLoadFailureReason.ModelFileInvalid;
  }
  if (matchesAny(text, startupTimeoutPatterns)) {
    return LlamaCppModelLoadFailureReason.StartupTimeout;
  }
  if (matchesAny(text, serviceUnavailablePatterns)) {
    return LlamaCppModelLoadFailureReason.ServiceUnavailable;
  }

  return LlamaCppModelLoadFailureReason.Unknown;
}

export function isRetryableLlamaCppModelLoadError(
  reason: LlamaCppModelLoadFailureReason,
): boolean {
  return (
    reason === LlamaCppModelLoadFailureReason.VramInsufficient ||
    reason === LlamaCppModelLoadFailureReason.SystemMemoryInsufficient ||
    reason === LlamaCppModelLoadFailureReason.ContextTooLarge ||
    reason === LlamaCppModelLoadFailureReason.ServiceUnavailable ||
    reason === LlamaCppModelLoadFailureReason.StartupTimeout
  );
}

export function getLlamaCppModelLoadFailureI18nKey(
  reason: LlamaCppModelLoadFailureReason,
): string {
  switch (reason) {
    case LlamaCppModelLoadFailureReason.ModelsLimitReached:
      return 'llamacppLoadModelLimitReached';
    case LlamaCppModelLoadFailureReason.GpuNotFound:
      return 'llamacppLoadModelGpuNotFound';
    case LlamaCppModelLoadFailureReason.GpuProbeFailed:
      return 'llamacppLoadModelGpuProbeFailed';
    case LlamaCppModelLoadFailureReason.VramInsufficient:
      return 'llamacppLoadModelVramInsufficient';
    case LlamaCppModelLoadFailureReason.SystemMemoryInsufficient:
      return 'llamacppLoadModelSystemMemoryInsufficient';
    case LlamaCppModelLoadFailureReason.ContextTooLarge:
      return 'llamacppLoadModelContextTooLarge';
    case LlamaCppModelLoadFailureReason.ModelFileInvalid:
      return 'llamacppLoadModelFileInvalid';
    case LlamaCppModelLoadFailureReason.ModelNotFound:
      return 'llamacppLoadModelNotFound';
    case LlamaCppModelLoadFailureReason.ServiceUnavailable:
      return 'llamacppLoadModelServiceUnavailable';
    case LlamaCppModelLoadFailureReason.StartupTimeout:
      return 'llamacppLoadModelStartupTimeout';
    case LlamaCppModelLoadFailureReason.Unknown:
      return 'llamacppLoadModelUnknown';
  }
}

function normalizeErrorText(error: unknown): string {
  if (error instanceof Error) {
    return [error.name, error.message].filter(Boolean).join('\n');
  }
  if (typeof error === 'string') return error;
  if (error === null || error === undefined) return '';
  return String(error);
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some(pattern => pattern.test(text));
}
