import type { SqliteStore } from '../../sqliteStore';
import {
  DEFAULT_LLAMACPP_SERVICE_CONFIG,
  getLlamaCppAcceleratorDevices,
  getLlamaCppModelsMaxLimitViolation,
  LLAMACPP_GPU_LAYERS_MAX,
  LLAMACPP_STRUCTURED_INTEGER_RANGES,
  LlamaCppGatewayAccessMode,
  LlamaCppOrchestrator,
  LlamaCppRuntimeBackend,
  LlamaCppRuntimeCudaMajor,
  LlamaCppMemoryPolicy,
  LlamaCppModelResidencyMode,
  LlamaCppStructuredServiceFieldKey,
  normalizeLlamaCppKvCacheType,
} from '../../../shared/llamacpp';
import type {
  LlamaCppModelLaunchInput,
  LlamaCppModelPreference,
  LlamaCppModelPreferences,
  LlamaCppServiceConfig,
  LlamaCppSetModelPreferenceInput,
} from '../../../shared/llamacpp';
import { ModelCapabilityStatus, type ModelCapabilities } from '../../../shared/providers';
import { resolveLlamaCppDeviceSelection } from '../../libs/llamacppManager';

export const LLAMACPP_SERVICE_CONFIG_KEY = 'llamacpp_service_config';
const OLLAMA_SERVICE_CONFIG_KEY = 'ollama_service_config';
export const LLAMACPP_MODEL_PREFERENCES_KEY = 'llamacpp_model_preferences';
const LLAMACPP_MODEL_PREFERENCE_CAPABILITY_KEYS = [
  'toolCalling',
  'imageInput',
  'videoInput',
  'audioInput',
  'documentInput',
  'reasoning',
] as const satisfies ReadonlyArray<keyof ModelCapabilities>;

const LLAMACPP_SANITIZED_NUMERIC_DEFAULTS = {
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

const LLAMACPP_MEMORY_BUDGET_PERCENT_RANGE = { min: 10, max: 90 } as const;

export function getLlamaCppServiceConfig(store: SqliteStore): LlamaCppServiceConfig {
  return sanitizeLlamaCppServiceConfig({
    ...DEFAULT_LLAMACPP_SERVICE_CONFIG,
    ...(store.get<LlamaCppServiceConfig>(LLAMACPP_SERVICE_CONFIG_KEY) ?? {}),
  });
}

export function getLlamaCppModelPreferences(store: SqliteStore): LlamaCppModelPreferences {
  return sanitizeLlamaCppModelPreferences(
    store.get<LlamaCppModelPreferences>(LLAMACPP_MODEL_PREFERENCES_KEY),
  );
}

export function migrateLegacyLlamaCppConfig(store: SqliteStore): void {
  migrateLegacyServiceConfig(store);
  enforceLlamaCppParallelTwo(store);
}

export function enforceLlamaCppParallelTwo(store: SqliteStore): void {
  const existing = store.get<LlamaCppServiceConfig>(LLAMACPP_SERVICE_CONFIG_KEY);
  if (!existing || existing.parallel === '2') return;
  store.set(LLAMACPP_SERVICE_CONFIG_KEY, { ...existing, parallel: '2' });
}

function migrateLegacyServiceConfig(store: SqliteStore): void {
  const existing = store.get<LlamaCppServiceConfig>(LLAMACPP_SERVICE_CONFIG_KEY);
  if (existing) return;
  const legacy = store.get<{ cudaVisibleDevices?: string; numParallel?: string }>(
    OLLAMA_SERVICE_CONFIG_KEY,
  );
  if (!legacy) return;
  store.set(
    LLAMACPP_SERVICE_CONFIG_KEY,
    sanitizeLlamaCppServiceConfig({
      device: legacy.cudaVisibleDevices,
    }),
  );
}

export function applyStoredModelPreferencesToLaunchInput(
  store: SqliteStore,
  input: LlamaCppModelLaunchInput,
): LlamaCppModelLaunchInput {
  const preference = getLlamaCppModelPreferences(store)[input.model.trim()];
  // ctxSize and nCpuMoe apply independently: either may be absent.
  const ctxSize = input.options?.ctxSize ? undefined : preference?.ctxSize;
  const nCpuMoe = input.options?.nCpuMoe !== undefined ? undefined : preference?.nCpuMoe;
  if (!ctxSize && !nCpuMoe) {
    return input;
  }

  return {
    ...input,
    options: {
      ...input.options,
      ...(ctxSize ? { ctxSize } : {}),
      ...(nCpuMoe !== undefined ? { nCpuMoe } : {}),
    },
  };
}

function sanitizeLlamaCppModelPreferences(
  preferences: LlamaCppModelPreferences | undefined,
): LlamaCppModelPreferences {
  if (!preferences || typeof preferences !== 'object') {
    return {};
  }

  return Object.fromEntries(
    Object.entries(preferences)
      .map(([modelName, preference]) => {
        const normalizedModelName = typeof modelName === 'string' ? modelName.trim() : '';
        if (!normalizedModelName) return null;
        const normalizedPreference = sanitizeLlamaCppModelPreference(preference);
        if (!normalizedPreference) return null;
        return [normalizedModelName, normalizedPreference] as const;
      })
      .filter((entry): entry is readonly [string, LlamaCppModelPreference] => Boolean(entry)),
  );
}

export function sanitizeUpdatedModelPreferences(
  current: LlamaCppModelPreferences,
  input: unknown,
): LlamaCppModelPreferences {
  if (!input || typeof input !== 'object') {
    return current;
  }

  const candidate = input as LlamaCppSetModelPreferenceInput;
  const modelName = typeof candidate.modelName === 'string' ? candidate.modelName.trim() : '';
  if (!modelName) {
    return current;
  }

  const normalizedPreference = sanitizeLlamaCppModelPreference(candidate.preference);
  if (!normalizedPreference) {
    const { [modelName]: _removedPreference, ...next } = current;
    return next;
  }

  return {
    ...current,
    [modelName]: normalizedPreference,
  };
}

export function getLlamaCppModelPreferenceInputName(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  const modelName = (input as LlamaCppSetModelPreferenceInput).modelName;
  const normalizedModelName = typeof modelName === 'string' ? modelName.trim() : '';
  return normalizedModelName || null;
}

export function shouldRefreshLlamaCppModelBindings(
  previous: LlamaCppModelPreference | undefined,
  next: LlamaCppModelPreference | undefined,
): boolean {
  if (previous?.ctxSize !== next?.ctxSize || previous?.maxTokens !== next?.maxTokens) {
    return true;
  }
  return LLAMACPP_MODEL_PREFERENCE_CAPABILITY_KEYS.some(
    key => previous?.capabilities?.[key] !== next?.capabilities?.[key],
  );
}

export function sanitizeLlamaCppModelPreference(
  preference: unknown,
): LlamaCppModelPreference | null {
  if (!preference || typeof preference !== 'object') {
    return null;
  }

  const candidate = preference as {
    ctxSize?: unknown;
    maxTokens?: unknown;
    nCpuMoe?: unknown;
    capabilities?: Record<string, unknown>;
    residency?: { mode?: unknown; idleMinutes?: unknown };
  };
  const parsedCtxSize =
    typeof candidate.ctxSize === 'number'
      ? candidate.ctxSize
      : typeof candidate.ctxSize === 'string'
        ? Number.parseInt(candidate.ctxSize, 10)
        : undefined;
  const ctxSizeRange =
    LLAMACPP_STRUCTURED_INTEGER_RANGES[LlamaCppStructuredServiceFieldKey.CtxSize];

  const ctxSize =
    typeof parsedCtxSize === 'number' &&
    Number.isFinite(parsedCtxSize) &&
    parsedCtxSize >= ctxSizeRange.min &&
    parsedCtxSize <= ctxSizeRange.max
      ? parsedCtxSize
      : undefined;
  const parsedMaxTokens =
    typeof candidate.maxTokens === 'number'
      ? candidate.maxTokens
      : typeof candidate.maxTokens === 'string'
        ? Number.parseInt(candidate.maxTokens, 10)
        : undefined;
  const maxTokens =
    typeof parsedMaxTokens === 'number' &&
    Number.isSafeInteger(parsedMaxTokens) &&
    parsedMaxTokens > 0
      ? parsedMaxTokens
      : undefined;
  const nCpuMoe =
    typeof candidate.nCpuMoe === 'number' &&
    Number.isSafeInteger(candidate.nCpuMoe) &&
    candidate.nCpuMoe >= 0
      ? candidate.nCpuMoe
      : undefined;
  const capabilities = Object.fromEntries(
    LLAMACPP_MODEL_PREFERENCE_CAPABILITY_KEYS.flatMap(key => {
      const status = candidate.capabilities?.[key];
      return status === ModelCapabilityStatus.Supported ||
        status === ModelCapabilityStatus.Unsupported ||
        status === ModelCapabilityStatus.Unknown
        ? [[key, status]]
        : [];
    }),
  ) as Partial<ModelCapabilities>;
  const residency =
    candidate.residency?.mode === LlamaCppModelResidencyMode.Forever
      ? { mode: LlamaCppModelResidencyMode.Forever }
      : candidate.residency?.mode === LlamaCppModelResidencyMode.Timed &&
          typeof candidate.residency.idleMinutes === 'number' &&
          Number.isSafeInteger(candidate.residency.idleMinutes) &&
          candidate.residency.idleMinutes >= 0 &&
          candidate.residency.idleMinutes <= 10_080
        ? {
            mode: LlamaCppModelResidencyMode.Timed,
            idleMinutes: candidate.residency.idleMinutes,
          }
        : undefined;

  return ctxSize || maxTokens || nCpuMoe !== undefined || Object.keys(capabilities).length > 0 || residency
    ? {
        ...(ctxSize ? { ctxSize } : {}),
        ...(maxTokens ? { maxTokens } : {}),
        ...(nCpuMoe !== undefined ? { nCpuMoe } : {}),
        ...(Object.keys(capabilities).length > 0 ? { capabilities } : {}),
        ...(residency ? { residency } : {}),
      }
    : null;
}

export function sanitizeLlamaCppServiceConfig(
  config: LlamaCppServiceConfig | undefined,
  runtimeDevices?: {
    success: boolean;
    devices?: Array<{ id?: string; name?: string }>;
  } | null,
): LlamaCppServiceConfig {
  const next: LlamaCppServiceConfig = {};
  const modelsMaxRange =
    LLAMACPP_STRUCTURED_INTEGER_RANGES[LlamaCppStructuredServiceFieldKey.ModelsMax];
  const timeoutRange =
    LLAMACPP_STRUCTURED_INTEGER_RANGES[LlamaCppStructuredServiceFieldKey.Timeout];
  const threadsHttpRange =
    LLAMACPP_STRUCTURED_INTEGER_RANGES[LlamaCppStructuredServiceFieldKey.ThreadsHttp];
  const cacheReuseRange =
    LLAMACPP_STRUCTURED_INTEGER_RANGES[LlamaCppStructuredServiceFieldKey.CacheReuse];
  const cacheRamRange =
    LLAMACPP_STRUCTURED_INTEGER_RANGES[LlamaCppStructuredServiceFieldKey.CacheRam];
  const ctxSizeRange =
    LLAMACPP_STRUCTURED_INTEGER_RANGES[LlamaCppStructuredServiceFieldKey.CtxSize];
  const parallelRange =
    LLAMACPP_STRUCTURED_INTEGER_RANGES[LlamaCppStructuredServiceFieldKey.Parallel];
  const batchSizeRange =
    LLAMACPP_STRUCTURED_INTEGER_RANGES[LlamaCppStructuredServiceFieldKey.BatchSize];
  const ubatchSizeRange =
    LLAMACPP_STRUCTURED_INTEGER_RANGES[LlamaCppStructuredServiceFieldKey.UbatchSize];
  const threadsRange =
    LLAMACPP_STRUCTURED_INTEGER_RANGES[LlamaCppStructuredServiceFieldKey.Threads];
  const threadsBatchRange =
    LLAMACPP_STRUCTURED_INTEGER_RANGES[LlamaCppStructuredServiceFieldKey.ThreadsBatch];
  const mainGpuRange =
    LLAMACPP_STRUCTURED_INTEGER_RANGES[LlamaCppStructuredServiceFieldKey.MainGpu];
  const host = config?.host?.trim();
  const listenHost = config?.listenHost?.trim();
  const gatewayAccessMode = config?.gatewayAccessMode;
  // Absent or invalid values stay absent: the orchestrator mode is resolved to
  // router at consumption sites, so snapshots do not churn with the default.
  const orchestrator = isLlamaCppOrchestrator(config?.orchestrator)
    ? config.orchestrator
    : undefined;
  const port = normalizeIntegerString(config?.port);
  const modelsDir = config?.modelsDir?.trim();
  const runtimeVersion = config?.runtimeVersion?.trim();
  const runtimeBackend = config?.runtimeBackend;
  const runtimeCudaMajor = config?.runtimeCudaMajor;
  const memoryPolicy = config?.memoryPolicy;
  const memoryBudgetPercent = normalizeIntegerNumber(config?.memoryBudgetPercent, {
    min: LLAMACPP_MEMORY_BUDGET_PERCENT_RANGE.min,
    max: LLAMACPP_MEMORY_BUDGET_PERCENT_RANGE.max,
  });
  const sanitizedModelsMax = normalizeIntegerStringWithDefault(config?.modelsMax, {
    min: modelsMaxRange.min,
    max: modelsMaxRange.max,
    defaultValue: LLAMACPP_SANITIZED_NUMERIC_DEFAULTS.modelsMax,
  });
  const modelsMax =
    sanitizedModelsMax === '0' ? LLAMACPP_SANITIZED_NUMERIC_DEFAULTS.modelsMax : sanitizedModelsMax;
  const modelsAutoload = config?.modelsAutoload as unknown;
  const keepRunningOnAppQuit = config?.keepRunningOnAppQuit as unknown;
  const timeout = normalizeIntegerStringWithDefault(config?.timeout, {
    min: timeoutRange.min,
    max: timeoutRange.max,
    defaultValue: LLAMACPP_SANITIZED_NUMERIC_DEFAULTS.timeout,
  });
  const threadsHttp = normalizeSignedIntegerStringWithDefault(config?.threadsHttp, {
    min: threadsHttpRange.min,
    max: threadsHttpRange.max,
    defaultValue: LLAMACPP_SANITIZED_NUMERIC_DEFAULTS.threadsHttp,
  });
  const cacheReuse = normalizeIntegerStringWithDefault(config?.cacheReuse, {
    min: cacheReuseRange.min,
    max: cacheReuseRange.max,
    defaultValue: LLAMACPP_SANITIZED_NUMERIC_DEFAULTS.cacheReuse,
  });
  const cacheRam = normalizeSignedIntegerStringWithDefault(config?.cacheRam, {
    min: cacheRamRange.min,
    max: cacheRamRange.max,
    defaultValue: LLAMACPP_SANITIZED_NUMERIC_DEFAULTS.cacheRam,
  });
  const ctxCheckpoints = normalizeIntegerString(config?.ctxCheckpoints);
  const checkpointEveryNt = normalizeSignedIntegerString(config?.checkpointEveryNt);
  const ctxSize = normalizeIntegerStringWithDefault(config?.ctxSize, {
    min: ctxSizeRange.min,
    max: ctxSizeRange.max,
    defaultValue: LLAMACPP_SANITIZED_NUMERIC_DEFAULTS.ctxSize,
  });
  const parallel = normalizeSignedIntegerStringWithDefault(config?.parallel, {
    min: parallelRange.min,
    max: parallelRange.max,
    defaultValue: LLAMACPP_SANITIZED_NUMERIC_DEFAULTS.parallel,
  });
  const batchSize = normalizeIntegerStringWithDefault(config?.batchSize, {
    min: batchSizeRange.min,
    max: batchSizeRange.max,
    defaultValue: LLAMACPP_SANITIZED_NUMERIC_DEFAULTS.batchSize,
  });
  const ubatchSize = normalizeIntegerStringWithDefault(config?.ubatchSize, {
    min: ubatchSizeRange.min,
    max: ubatchSizeRange.max,
    defaultValue: LLAMACPP_SANITIZED_NUMERIC_DEFAULTS.ubatchSize,
  });
  const gpuLayers = normalizeGpuLayersStringWithDefault(config?.gpuLayers, {
    min: 0,
    max: LLAMACPP_GPU_LAYERS_MAX,
    defaultValue: LLAMACPP_SANITIZED_NUMERIC_DEFAULTS.gpuLayers,
  });
  const threads = normalizeSignedIntegerStringWithDefault(config?.threads, {
    min: threadsRange.min,
    max: threadsRange.max,
    defaultValue: LLAMACPP_SANITIZED_NUMERIC_DEFAULTS.threads,
  });
  const threadsBatch = normalizeSignedIntegerStringWithDefault(config?.threadsBatch, {
    min: threadsBatchRange.min,
    max: threadsBatchRange.max,
    defaultValue: LLAMACPP_SANITIZED_NUMERIC_DEFAULTS.threadsBatch,
  });
  const device = normalizeVisibleDevices(config?.device, runtimeDevices);
  const splitMode = isSplitMode(config?.splitMode) ? config.splitMode : undefined;
  const mainGpu = normalizeIntegerStringWithDefault(config?.mainGpu, {
    min: mainGpuRange.min,
    max: mainGpuRange.max,
    defaultValue: LLAMACPP_SANITIZED_NUMERIC_DEFAULTS.mainGpu,
  });
  const tensorSplit = normalizeTensorSplit(config?.tensorSplit, {
    splitMode,
    runtimeDevices,
  });
  const reasoningBudget = normalizeSignedIntegerString(config?.reasoningBudget);

  if (host === '0.0.0.0' && !listenHost) {
    next.host = DEFAULT_LLAMACPP_SERVICE_CONFIG.host ?? '127.0.0.1';
    next.listenHost = host;
  } else if (host) {
    next.host = host;
  }
  if (listenHost) next.listenHost = listenHost;
  if (
    gatewayAccessMode === LlamaCppGatewayAccessMode.Local ||
    gatewayAccessMode === LlamaCppGatewayAccessMode.Lan
  ) {
    next.gatewayAccessMode = gatewayAccessMode;
  }
  if (orchestrator) next.orchestrator = orchestrator;
  if (port) next.port = port;
  if (modelsDir) next.modelsDir = modelsDir;
  if (runtimeVersion && /^b\d+(?:-[a-f0-9]+)?$/i.test(runtimeVersion))
    next.runtimeVersion = runtimeVersion;
  if (isRuntimeBackend(runtimeBackend)) next.runtimeBackend = runtimeBackend;
  if (isRuntimeCudaMajor(runtimeCudaMajor)) next.runtimeCudaMajor = runtimeCudaMajor;
  if (memoryPolicy === LlamaCppMemoryPolicy.Auto || memoryPolicy === LlamaCppMemoryPolicy.Manual) {
    next.memoryPolicy = memoryPolicy;
  }
  if (memoryBudgetPercent !== undefined) next.memoryBudgetPercent = memoryBudgetPercent;
  if (modelsMax) next.modelsMax = modelsMax;
  if (modelsAutoload !== undefined && modelsMax === '1') {
    if (typeof modelsAutoload === 'boolean') next.modelsAutoload = modelsAutoload;
    if (modelsAutoload === 'true') next.modelsAutoload = true;
    if (modelsAutoload === 'false') next.modelsAutoload = false;
  } else if (modelsAutoload !== undefined) {
    next.modelsAutoload = false;
  }
  if (typeof keepRunningOnAppQuit === 'boolean') {
    next.keepRunningOnAppQuit = keepRunningOnAppQuit;
  }
  if (timeout) next.timeout = timeout;
  if (threadsHttp) next.threadsHttp = threadsHttp;
  if (typeof config?.cachePrompt === 'boolean') next.cachePrompt = config.cachePrompt;
  if (cacheReuse) next.cacheReuse = cacheReuse;
  if (cacheRam) next.cacheRam = cacheRam;
  if (ctxCheckpoints) next.ctxCheckpoints = ctxCheckpoints;
  if (checkpointEveryNt) next.checkpointEveryNt = checkpointEveryNt;
  if (ctxSize) next.ctxSize = ctxSize;
  if (parallel) next.parallel = parallel;
  if (typeof config?.kvUnified === 'boolean') next.kvUnified = config.kvUnified;
  if (batchSize) next.batchSize = batchSize;
  if (ubatchSize) next.ubatchSize = ubatchSize;
  if (gpuLayers) next.gpuLayers = gpuLayers;
  if (threads) next.threads = threads;
  if (threadsBatch) next.threadsBatch = threadsBatch;
  if (device) next.device = device;
  if (mainGpu) next.mainGpu = mainGpu;
  if (splitMode) next.splitMode = splitMode;
  if (tensorSplit) next.tensorSplit = tensorSplit;
  if (isOnOffAuto(config?.flashAttn)) next.flashAttn = config.flashAttn;
  if (isLlamaCppKvCacheType(config?.cacheTypeK)) next.cacheTypeK = config.cacheTypeK.trim();
  if (isLlamaCppKvCacheType(config?.cacheTypeV)) next.cacheTypeV = config.cacheTypeV.trim();
  if (isOnOffAuto(config?.jinja)) next.jinja = config.jinja;
  if (isOnOffAuto(config?.reasoning)) next.reasoning = config.reasoning;
  if (isReasoningFormat(config?.reasoningFormat)) next.reasoningFormat = config.reasoningFormat;
  if (reasoningBudget) next.reasoningBudget = reasoningBudget;
  if (config?.reasoningBudgetMessage?.trim())
    next.reasoningBudgetMessage = config.reasoningBudgetMessage.trim();
  if (config?.chatTemplate?.trim()) next.chatTemplate = config.chatTemplate.trim();
  if (config?.chatTemplateFile?.trim()) next.chatTemplateFile = config.chatTemplateFile.trim();
  if (typeof config?.skipChatParsing === 'boolean') next.skipChatParsing = config.skipChatParsing;
  if (typeof config?.prefillAssistant === 'boolean')
    next.prefillAssistant = config.prefillAssistant;
  if (typeof config?.noMmap === 'boolean') next.noMmap = config.noMmap;
  if (typeof config?.mlock === 'boolean') next.mlock = config.mlock;
  return next;
}

export function sanitizeLlamaCppBackendRef(
  input: unknown,
): { version: string; backend: string; versionBackend: string } | null {
  if (!input || typeof input !== 'object') return null;
  const candidate = input as { version?: unknown; backend?: unknown; versionBackend?: unknown };
  let version = typeof candidate.version === 'string' ? candidate.version.trim() : '';
  let backend = typeof candidate.backend === 'string' ? candidate.backend.trim() : '';
  const versionBackend =
    typeof candidate.versionBackend === 'string' ? candidate.versionBackend.trim() : '';
  if ((!version || !backend) && versionBackend.includes('/')) {
    const [parsedVersion, parsedBackend] = versionBackend.split('/');
    version = parsedVersion?.trim() ?? '';
    backend = parsedBackend?.trim() ?? '';
  }
  if (!isSafeLlamaCppBackendSegment(version) || !isSafeLlamaCppBackendSegment(backend)) {
    return null;
  }
  return { version, backend, versionBackend: `${version}/${backend}` };
}

function isSafeLlamaCppBackendSegment(value: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(value) && !value.includes('..');
}

function normalizeIntegerString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (!/^\d+$/.test(trimmed)) return undefined;
  return trimmed;
}

function normalizeIntegerNumber(
  value: number | undefined,
  range: { min: number; max: number },
): number | undefined {
  if (!Number.isInteger(value)) return undefined;
  if (value < range.min || value > range.max) return undefined;
  return value;
}

function normalizeIntegerStringWithDefault(
  value: string | undefined,
  range: { min: number; max: number; defaultValue: string },
): string | undefined {
  const trimmed = value?.trim();
  if (trimmed === '' && range.min === 0) return range.defaultValue;
  if (!trimmed) return undefined;
  const normalized = normalizeIntegerString(value);
  if (!normalized) return range.defaultValue;
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed)) return range.defaultValue;
  if (parsed < range.min || parsed > range.max) return range.defaultValue;
  return normalized;
}

function normalizeSignedIntegerString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (!/^-?\d+$/.test(trimmed)) return undefined;
  return trimmed;
}

function normalizeSignedIntegerStringWithDefault(
  value: string | undefined,
  range: { min: number; max: number; defaultValue: string },
): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const normalized = normalizeSignedIntegerString(value);
  if (!normalized) return range.defaultValue;
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed)) return range.defaultValue;
  if (parsed < range.min || parsed > range.max) return range.defaultValue;
  return normalized;
}

function normalizeGpuLayersString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (trimmed === 'auto' || trimmed === 'all') return trimmed;
  if (!/^-?\d+$/.test(trimmed)) return undefined;
  return trimmed;
}

function normalizeGpuLayersStringWithDefault(
  value: string | undefined,
  range: { min: number; max: number; defaultValue: string },
): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const normalized = normalizeGpuLayersString(value);
  if (!normalized) return range.defaultValue;
  if (normalized === 'auto' || normalized === 'all') return normalized;
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed)) return range.defaultValue;
  if (parsed < range.min || parsed > range.max) return range.defaultValue;
  return normalized;
}

function normalizeVisibleDevices(
  value: string | undefined,
  runtimeDevices?: {
    success: boolean;
    devices?: Array<{ id?: string; name?: string; backend?: string }>;
  } | null,
): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;

  const acceleratorDevices = getLlamaCppAcceleratorDevices(runtimeDevices).map(device => ({
    id: device.id,
    name: device.name ?? device.id,
    backend: device.backend ?? 'unknown',
  }));

  if (acceleratorDevices.length > 0) {
    const resolved = resolveLlamaCppDeviceSelection(trimmed, acceleratorDevices);
    return resolved || undefined;
  }

  if (runtimeDevices && !runtimeDevices.success) {
    return undefined;
  }

  if (
    !runtimeDevices?.success ||
    !Array.isArray(runtimeDevices.devices) ||
    runtimeDevices.devices.length === 0
  ) {
    const tokens = trimmed
      .split(',')
      .map(part => part.trim())
      .filter(Boolean);
    if (tokens.length === 0) return undefined;

    const normalizedTokens = tokens.map(token => (/^[A-Za-z0-9_.:-]+$/.test(token) ? token : ''));
    if (normalizedTokens.some(token => !token)) {
      return undefined;
    }
    return normalizedTokens.join(',');
  }
  return undefined;
}

function normalizeTensorSplit(
  value: string | undefined,
  options?: {
    splitMode?: NonNullable<LlamaCppServiceConfig['splitMode']>;
    runtimeDevices?: {
      success: boolean;
      devices?: Array<{ id?: string; name?: string }>;
    } | null;
  },
): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (options?.splitMode !== 'tensor') return undefined;

  const parts = trimmed
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return undefined;

  const normalizedParts: string[] = [];
  for (const part of parts) {
    if (!/^\d+(?:\.\d+)?$/.test(part)) {
      return undefined;
    }
    const parsed = Number(part);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1024) {
      return undefined;
    }
    normalizedParts.push(Number.isInteger(parsed) ? String(parsed) : String(parsed));
  }

  if (
    options?.runtimeDevices?.success &&
    Array.isArray(options.runtimeDevices.devices) &&
    options.runtimeDevices.devices.length > 0 &&
    normalizedParts.length > options.runtimeDevices.devices.length
  ) {
    return undefined;
  }

  return normalizedParts.join(',');
}

function isSplitMode(value: unknown): value is NonNullable<LlamaCppServiceConfig['splitMode']> {
  return value === 'none' || value === 'layer' || value === 'row' || value === 'tensor';
}

function isOnOffAuto(value: unknown): value is 'on' | 'off' | 'auto' {
  return value === 'on' || value === 'off' || value === 'auto';
}

function isRuntimeBackend(
  value: unknown,
): value is NonNullable<LlamaCppServiceConfig['runtimeBackend']> {
  return (
    value === LlamaCppRuntimeBackend.Auto ||
    value === LlamaCppRuntimeBackend.Cpu ||
    value === LlamaCppRuntimeBackend.Cuda
  );
}

function isRuntimeCudaMajor(
  value: unknown,
): value is NonNullable<LlamaCppServiceConfig['runtimeCudaMajor']> {
  return value === LlamaCppRuntimeCudaMajor.Cuda12 || value === LlamaCppRuntimeCudaMajor.Cuda13;
}

function isLlamaCppKvCacheType(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false;
  return normalizeLlamaCppKvCacheType(value) === value.trim().toLowerCase();
}

function isLlamaCppOrchestrator(value: unknown): value is LlamaCppOrchestrator {
  return value === LlamaCppOrchestrator.Router || value === LlamaCppOrchestrator.Daemon;
}

function isReasoningFormat(
  value: unknown,
): value is NonNullable<LlamaCppServiceConfig['reasoningFormat']> {
  return (
    value === 'none' || value === 'deepseek' || value === 'deepseek-legacy' || value === 'auto'
  );
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
