import {
  LlamaCppModelResidencyMode,
  type LlamaCppModelResidencyMode as LlamaCppModelResidencyModeType,
} from '../../shared/llamacpp';

const DEFAULT_IDLE_MINUTES = 30;
const MIN_IDLE_MINUTES = 0;
const MAX_IDLE_MINUTES = 10_080;

export const LlamaCppModelResidencyState = {
  Unloaded: 'unloaded',
  Loading: 'loading',
  Ready: 'ready',
  InUse: 'in-use',
  Unloading: 'unloading',
} as const;
export type LlamaCppModelResidencyState =
  (typeof LlamaCppModelResidencyState)[keyof typeof LlamaCppModelResidencyState];

export type LlamaCppModelResidencyPolicy = {
  mode: LlamaCppModelResidencyModeType;
  idleMinutes?: number;
};

export type LlamaCppModelResidencySnapshot = {
  modelName: string;
  state: LlamaCppModelResidencyState;
  activeRequests: number;
  expiresAt?: number;
  policy: LlamaCppModelResidencyPolicy;
};

type ModelRecord = LlamaCppModelResidencySnapshot & {
  activeLeaseIds: Set<number>;
  loading?: Promise<void>;
};

type TimerApi = {
  now: () => number;
  setTimeout: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
};

type LlamaCppModelResidencyManagerOptions = {
  unload: (modelName: string) => Promise<void>;
  getPolicy: (modelName: string) => LlamaCppModelResidencyPolicy | undefined;
  timer?: TimerApi;
  onStateChanged?: (snapshot: LlamaCppModelResidencySnapshot) => void;
};

export class LlamaCppModelResidencyManager {
  private readonly records = new Map<string, ModelRecord>();
  private readonly timer: TimerApi;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private nextLeaseId = 0;

  constructor(private readonly options: LlamaCppModelResidencyManagerOptions) {
    this.timer =
      options.timer ??
      ({
        now: Date.now,
        setTimeout,
        clearTimeout,
      } satisfies TimerApi);
  }

  getSnapshot(modelName: string): LlamaCppModelResidencySnapshot | undefined {
    const record = this.records.get(modelName.trim());
    return record ? this.toSnapshot(record) : undefined;
  }

  markReady(modelName: string): void {
    const record = this.getOrCreateRecord(modelName);
    if (record.activeRequests > 0) {
      record.state = LlamaCppModelResidencyState.InUse;
      record.expiresAt = undefined;
    } else {
      record.state = LlamaCppModelResidencyState.Ready;
      this.renewExpiry(record);
    }
    this.emit(record);
    this.scheduleExpiryTimer();
  }

  markUnloaded(modelName: string): void {
    const record = this.getOrCreateRecord(modelName);
    record.state = LlamaCppModelResidencyState.Unloaded;
    record.expiresAt = undefined;
    record.loading = undefined;
    record.activeLeaseIds.clear();
    record.activeRequests = 0;
    this.emit(record);
    this.scheduleExpiryTimer();
  }

  async ensureReady(modelName: string, load: () => Promise<void>): Promise<void> {
    const record = this.getOrCreateRecord(modelName);
    if (
      record.state === LlamaCppModelResidencyState.Ready ||
      record.state === LlamaCppModelResidencyState.InUse
    ) {
      return;
    }
    if (record.loading) {
      await record.loading;
      return;
    }

    record.state = LlamaCppModelResidencyState.Loading;
    record.expiresAt = undefined;
    this.emit(record);
    const loading = load()
      .then(() => {
        record.loading = undefined;
        this.markReady(record.modelName);
      })
      .catch(error => {
        record.loading = undefined;
        record.state = LlamaCppModelResidencyState.Unloaded;
        record.expiresAt = undefined;
        this.emit(record);
        throw error;
      });
    record.loading = loading;
    await loading;
  }

  async acquire(modelName: string, load: () => Promise<void>): Promise<() => void> {
    const record = this.getOrCreateRecord(modelName);
    await this.ensureReady(record.modelName, load);
    const leaseId = ++this.nextLeaseId;
    record.activeLeaseIds.add(leaseId);
    record.activeRequests = record.activeLeaseIds.size;
    record.state = LlamaCppModelResidencyState.InUse;
    record.expiresAt = undefined;
    this.emit(record);
    this.scheduleExpiryTimer();

    return () => this.release(record.modelName, leaseId);
  }

  beginManualUnload(modelName: string): void {
    const record = this.getOrCreateRecord(modelName);
    record.state = LlamaCppModelResidencyState.Unloading;
    record.expiresAt = undefined;
    this.emit(record);
    this.scheduleExpiryTimer();
  }

  dispose(): void {
    if (this.expiryTimer) {
      this.timer.clearTimeout(this.expiryTimer);
      this.expiryTimer = null;
    }
  }

  private release(modelName: string, leaseId: number): void {
    const record = this.records.get(modelName);
    if (!record || !record.activeLeaseIds.delete(leaseId)) return;

    record.activeRequests = record.activeLeaseIds.size;
    if (record.activeRequests === 0) {
      record.state = LlamaCppModelResidencyState.Ready;
      this.renewExpiry(record);
    }
    this.emit(record);
    this.scheduleExpiryTimer();
  }

  private getOrCreateRecord(rawModelName: string): ModelRecord {
    const modelName = rawModelName.trim();
    if (!modelName) throw new Error('Model name is required');
    const existing = this.records.get(modelName);
    if (existing) return existing;

    const record: ModelRecord = {
      modelName,
      state: LlamaCppModelResidencyState.Unloaded,
      activeRequests: 0,
      activeLeaseIds: new Set<number>(),
      policy: normalizePolicy(this.options.getPolicy(modelName)),
    };
    this.records.set(modelName, record);
    return record;
  }

  private renewExpiry(record: ModelRecord): void {
    record.policy = normalizePolicy(this.options.getPolicy(record.modelName));
    if (record.policy.mode === LlamaCppModelResidencyMode.Forever) {
      record.expiresAt = undefined;
      return;
    }
    record.expiresAt = this.timer.now() + getIdleMilliseconds(record.policy);
  }

  private scheduleExpiryTimer(): void {
    if (this.expiryTimer) {
      this.timer.clearTimeout(this.expiryTimer);
      this.expiryTimer = null;
    }
    const now = this.timer.now();
    const nextExpiry = [...this.records.values()]
      .filter(record => record.state === LlamaCppModelResidencyState.Ready && record.expiresAt)
      .map(record => record.expiresAt as number)
      .sort((left, right) => left - right)[0];
    if (!nextExpiry) return;

    this.expiryTimer = this.timer.setTimeout(() => {
      this.expiryTimer = null;
      void this.handleExpiry().catch(error => {
        console.warn('[LlamaCppResidency] automatic model unload failed:', error);
      });
    }, Math.max(0, nextExpiry - now));
  }

  private async handleExpiry(): Promise<void> {
    const now = this.timer.now();
    const dueRecords = [...this.records.values()].filter(
      record =>
        record.state === LlamaCppModelResidencyState.Ready &&
        record.activeRequests === 0 &&
        record.expiresAt !== undefined &&
        record.expiresAt <= now,
    );
    for (const record of dueRecords) {
      record.state = LlamaCppModelResidencyState.Unloading;
      record.expiresAt = undefined;
      this.emit(record);
      try {
        await this.options.unload(record.modelName);
        this.markUnloaded(record.modelName);
      } catch (error) {
        record.state = LlamaCppModelResidencyState.Ready;
        this.renewExpiry(record);
        this.emit(record);
        throw error;
      }
    }
    this.scheduleExpiryTimer();
  }

  private emit(record: ModelRecord): void {
    this.options.onStateChanged?.(this.toSnapshot(record));
  }

  private toSnapshot(record: ModelRecord): LlamaCppModelResidencySnapshot {
    return {
      modelName: record.modelName,
      state: record.state,
      activeRequests: record.activeRequests,
      ...(record.expiresAt ? { expiresAt: record.expiresAt } : {}),
      policy: { ...record.policy },
    };
  }
}

export function normalizeLlamaCppModelResidencyPolicy(
  policy: LlamaCppModelResidencyPolicy | undefined,
): LlamaCppModelResidencyPolicy {
  return normalizePolicy(policy);
}

function normalizePolicy(
  policy: LlamaCppModelResidencyPolicy | undefined,
): LlamaCppModelResidencyPolicy {
  if (policy?.mode === LlamaCppModelResidencyMode.Forever) {
    return { mode: LlamaCppModelResidencyMode.Forever };
  }
  const idleMinutes = Number.isFinite(policy?.idleMinutes)
    ? Math.round(policy?.idleMinutes ?? DEFAULT_IDLE_MINUTES)
    : DEFAULT_IDLE_MINUTES;
  return {
    mode: LlamaCppModelResidencyMode.Timed,
    idleMinutes: Math.min(MAX_IDLE_MINUTES, Math.max(MIN_IDLE_MINUTES, idleMinutes)),
  };
}

function getIdleMilliseconds(policy: LlamaCppModelResidencyPolicy): number {
  return (policy.idleMinutes ?? DEFAULT_IDLE_MINUTES) * 60_000;
}
