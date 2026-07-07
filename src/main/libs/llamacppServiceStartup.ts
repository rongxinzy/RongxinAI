import type { LlamaCppStatusSnapshot } from '../../shared/llamacpp';

export const LlamaCppServiceStartupFailureCode = {
  PortInUse: 'port-in-use',
  ProcessExited: 'process-exited',
  StartupTimeout: 'startup-timeout',
  BackendUnavailable: 'backend-unavailable',
  RuntimeDamaged: 'runtime-damaged',
  Unknown: 'unknown',
} as const;

export type LlamaCppServiceStartupFailureCode =
  typeof LlamaCppServiceStartupFailureCode[keyof typeof LlamaCppServiceStartupFailureCode];

export const LlamaCppServiceStartupReason = {
  LoadModel: 'load-model',
  ManualStart: 'manual-start',
  ManualRestart: 'manual-restart',
  Unknown: 'unknown',
} as const;

export type LlamaCppServiceStartupReason =
  typeof LlamaCppServiceStartupReason[keyof typeof LlamaCppServiceStartupReason];

export type LlamaCppServiceEnsureSuccess = {
  success: true;
  serviceStatus: LlamaCppStatusSnapshot;
  retriedDetection: boolean;
};

export type LlamaCppServiceEnsureFailure = {
  success: false;
  code: LlamaCppServiceStartupFailureCode;
  serviceStatus: LlamaCppStatusSnapshot;
  startStatus?: LlamaCppStatusSnapshot;
  detectedStatus?: LlamaCppStatusSnapshot;
  retriedDetection: true;
  detail?: string;
};

export type LlamaCppServiceEnsureResult =
  | LlamaCppServiceEnsureSuccess
  | LlamaCppServiceEnsureFailure;

type LlamaCppServiceManagerLike = {
  detect: () => Promise<LlamaCppStatusSnapshot>;
  start: () => Promise<LlamaCppStatusSnapshot>;
  getStatus?: () => LlamaCppStatusSnapshot;
};

type LlamaCppServiceStartupFailureInput = {
  initialStatus?: LlamaCppStatusSnapshot;
  startStatus?: LlamaCppStatusSnapshot;
  detectedStatus?: LlamaCppStatusSnapshot;
};

export type LlamaCppServiceStartupLogger = Pick<typeof console, 'log' | 'warn'>;

export type LlamaCppServiceEnsureOptions = {
  reason?: LlamaCppServiceStartupReason;
  logger?: LlamaCppServiceStartupLogger;
};

const LlamaCppServerStatusValue = {
  Running: 'running',
  Stopped: 'stopped',
  Error: 'error',
  NotInstalled: 'not-installed',
} as const;

const portInUsePatterns = [
  /\beaddrinuse\b/i,
  /address already in use/i,
  /address is already in use/i,
  /only one usage of each socket address/i,
  /failed to bind/i,
  /bind.*(?:failed|error)/i,
  /port\s+\d+\s+(?:is\s+)?(?:already\s+)?in use/i,
];

const backendUnavailablePatterns = [
  /no cuda-capable device/i,
  /cuda error/i,
  /cuda.*(?:unavailable|not available|failed|missing|not found|unsupported|cannot|could not)/i,
  /(?:unavailable|not available|failed|missing|not found|unsupported|cannot|could not).*cuda/i,
  /cublas.*(?:failed|missing|not found|unsupported|cannot|could not)/i,
  /gpu.*(?:unavailable|not available|failed|missing|not found|unsupported|cannot|could not)/i,
  /(?:unavailable|not available|failed|missing|not found|unsupported|cannot|could not).*gpu/i,
  /vulkan.*(?:unavailable|not available|failed|missing|not found|unsupported|cannot|could not)/i,
  /metal.*(?:unavailable|not available|failed|missing|not found|unsupported|cannot|could not)/i,
  /(?:hip|rocm).*?(?:unavailable|not available|failed|missing|not found|unsupported|cannot|could not)/i,
  /openvino.*(?:unavailable|not available|failed|missing|not found|unsupported|cannot|could not)/i,
  /sycl.*(?:unavailable|not available|failed|missing|not found|unsupported|cannot|could not)/i,
  /backend.*(?:unavailable|not available|failed|missing|not found|unsupported|cannot|could not)/i,
  /device.*(?:unavailable|not available|failed|missing|not found|unsupported|cannot|could not)/i,
  /driver.*(?:unavailable|not available|failed|missing|not found|unsupported|cannot|could not)/i,
  /ggml_.*init.*failed/i,
];

const startupTimeoutPatterns = [
  /timeout/i,
  /timed out/i,
  /did not become ready/i,
  /health check.*(?:failed|timeout)/i,
];

const runtimeDamagedPatterns = [
  /not installed/i,
  /executable.*(?:missing|not found|unavailable)/i,
  /llama-server.*(?:missing|not found|unavailable)/i,
  /runtime.*(?:missing|damaged|invalid|not found|unavailable)/i,
  /\benoent\b/i,
  /no such file/i,
  /path.*not found/i,
  /cannot find.*llama/i,
];

const processExitedPatterns = [
  /exited unexpectedly/i,
  /process exited/i,
  /exit code/i,
  /terminated/i,
  /\bsignal\b/i,
  /spawn.*exit/i,
];

export async function ensureLlamaCppServiceRunning(
  manager: LlamaCppServiceManagerLike,
  options: LlamaCppServiceEnsureOptions = {},
): Promise<LlamaCppServiceEnsureResult> {
  const logger = options.logger ?? console;
  const reason = options.reason ?? LlamaCppServiceStartupReason.Unknown;
  const reasonPhrase = getLlamaCppServiceStartupReasonPhrase(reason);

  logger.log(`[LlamaCpp] ensuring service ${reasonPhrase}`);
  const initialStatus = await manager.detect();
  if (initialStatus.status === LlamaCppServerStatusValue.Running) {
    logRunningLlamaCppService(logger, initialStatus, reasonPhrase);
    return {
      success: true,
      serviceStatus: initialStatus,
      retriedDetection: false,
    };
  }

  logger.log(`[LlamaCpp] starting service ${reasonPhrase}`);
  const startStatus = await startLlamaCppService(manager);
  if (startStatus.status === LlamaCppServerStatusValue.Running) {
    logger.log(`[LlamaCpp] service is ready ${reasonPhrase} after startup`);
    return {
      success: true,
      serviceStatus: startStatus,
      retriedDetection: false,
    };
  }

  logger.log(`[LlamaCpp] service was not ready ${reasonPhrase}; retrying detection once`);
  const detectedStatus = await detectLlamaCppService(manager);
  if (detectedStatus.status === LlamaCppServerStatusValue.Running) {
    logger.log(`[LlamaCpp] service is ready ${reasonPhrase} after retry detection`);
    return {
      success: true,
      serviceStatus: detectedStatus,
      retriedDetection: true,
    };
  }

  const classification = classifyLlamaCppServiceStartupFailure({
    initialStatus,
    startStatus,
    detectedStatus,
  });

  logger.warn(
    `[LlamaCpp] service startup failed ${reasonPhrase} with classification ${classification.code}`,
  );

  return {
    success: false,
    serviceStatus: detectedStatus,
    startStatus,
    detectedStatus,
    retriedDetection: true,
    ...classification,
  };
}

export function classifyLlamaCppServiceStartupFailure(
  input: LlamaCppServiceStartupFailureInput,
): {
  code: LlamaCppServiceStartupFailureCode;
  detail?: string;
} {
  const statuses = [
    input.detectedStatus,
    input.startStatus,
    input.initialStatus,
  ].filter((status): status is LlamaCppStatusSnapshot => Boolean(status));
  const combinedText = statuses
    .map(status => `${status.status}\n${status.error ?? ''}`)
    .join('\n')
    .trim();
  const detail = pickFailureDetail(statuses);

  if (matchesAny(combinedText, portInUsePatterns)) {
    return { code: LlamaCppServiceStartupFailureCode.PortInUse, detail };
  }

  if (matchesAny(combinedText, backendUnavailablePatterns)) {
    return { code: LlamaCppServiceStartupFailureCode.BackendUnavailable, detail };
  }

  if (matchesAny(combinedText, startupTimeoutPatterns)) {
    return { code: LlamaCppServiceStartupFailureCode.StartupTimeout, detail };
  }

  if (
    statuses.some(status => status.status === LlamaCppServerStatusValue.NotInstalled) ||
    matchesAny(combinedText, runtimeDamagedPatterns)
  ) {
    return { code: LlamaCppServiceStartupFailureCode.RuntimeDamaged, detail };
  }

  if (
    statuses.some(status => status.status === LlamaCppServerStatusValue.Stopped) ||
    matchesAny(combinedText, processExitedPatterns)
  ) {
    return { code: LlamaCppServiceStartupFailureCode.ProcessExited, detail };
  }

  return { code: LlamaCppServiceStartupFailureCode.Unknown, detail };
}

export function getLlamaCppServiceStartupFailureI18nKey(
  code: LlamaCppServiceStartupFailureCode,
): string {
  switch (code) {
    case LlamaCppServiceStartupFailureCode.PortInUse:
      return 'llamacppServiceStartupPortInUse';
    case LlamaCppServiceStartupFailureCode.ProcessExited:
      return 'llamacppServiceStartupProcessExited';
    case LlamaCppServiceStartupFailureCode.StartupTimeout:
      return 'llamacppServiceStartupTimeout';
    case LlamaCppServiceStartupFailureCode.BackendUnavailable:
      return 'llamacppServiceStartupBackendUnavailable';
    case LlamaCppServiceStartupFailureCode.RuntimeDamaged:
      return 'llamacppServiceStartupRuntimeDamaged';
    case LlamaCppServiceStartupFailureCode.Unknown:
      return 'llamacppServiceStartupUnknown';
  }
}

async function startLlamaCppService(
  manager: LlamaCppServiceManagerLike,
): Promise<LlamaCppStatusSnapshot> {
  try {
    return await manager.start();
  } catch (error) {
    return getFallbackStatus(manager, error);
  }
}

async function detectLlamaCppService(
  manager: LlamaCppServiceManagerLike,
): Promise<LlamaCppStatusSnapshot> {
  try {
    return await manager.detect();
  } catch (error) {
    return getFallbackStatus(manager, error);
  }
}

function getFallbackStatus(
  manager: LlamaCppServiceManagerLike,
  error: unknown,
): LlamaCppStatusSnapshot {
  const currentStatus = manager.getStatus?.();
  const message = error instanceof Error ? error.message : String(error);
  return {
    ...(currentStatus ?? {
      status: LlamaCppServerStatusValue.Error,
      checkedAt: new Date().toISOString(),
    }),
    status: currentStatus?.status ?? LlamaCppServerStatusValue.Error,
    error: message || currentStatus?.error,
    checkedAt: currentStatus?.checkedAt ?? new Date().toISOString(),
  };
}

function pickFailureDetail(statuses: LlamaCppStatusSnapshot[]): string | undefined {
  return statuses.map(status => status.error?.trim()).find(Boolean);
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some(pattern => pattern.test(text));
}

function getLlamaCppServiceStartupReasonPhrase(reason: LlamaCppServiceStartupReason): string {
  switch (reason) {
    case LlamaCppServiceStartupReason.LoadModel:
      return 'before loading model';
    case LlamaCppServiceStartupReason.ManualStart:
      return 'for manual start';
    case LlamaCppServiceStartupReason.ManualRestart:
      return 'for manual restart';
    case LlamaCppServiceStartupReason.Unknown:
      return 'for an unspecified operation';
  }
}

function logRunningLlamaCppService(
  logger: LlamaCppServiceStartupLogger,
  status: LlamaCppStatusSnapshot,
  reasonPhrase: string,
): void {
  if (status.managedByApp) {
    const pidText = status.pid ? ` with pid ${status.pid}` : '';
    logger.log(`[LlamaCpp] service is already running ${reasonPhrase}, managed by this app${pidText}`);
    return;
  }
  logger.log(
    `[LlamaCpp] service is already running ${reasonPhrase}, detected as external or leftover process`,
  );
}
