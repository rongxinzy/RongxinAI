/**
 * Pure parsing helpers for the llama-server router (b9244) management surface.
 * They turn GET /models and GET /slots?model=X responses into typed snapshots
 * without touching the network, so callers stay trivially testable.
 */

/** Synthetic entry the router derives from the preset's global `[*]` section. */
export const LLAMACPP_ROUTER_SYNTHETIC_MODEL_IDS = ['default'] as const;

export type LlamaCppRouterModelState = 'unloaded' | 'loading' | 'loaded' | 'sleeping' | 'failed';

export type LlamaCppRouterModelSnapshot = {
  id: string;
  state: LlamaCppRouterModelState;
  /** Model file from the `--model` arg; absent on synthetic entries. */
  modelPath?: string;
  exitCode?: number;
  /** Child port from the `--port` arg; only set when running (port 0 = not running). */
  port?: number;
};

export type LlamaCppRouterModelSlots = {
  busy: boolean;
  processingSlots: number;
  totalSlots: number;
};

/** Fail-safe slot snapshot for unknown/unreachable models: never look idle. */
export const LLAMACPP_ROUTER_SLOTS_BUSY_UNKNOWN: LlamaCppRouterModelSlots = {
  busy: true,
  processingSlots: 0,
  totalSlots: 0,
};

type RouterModelsPayload = {
  data?: unknown;
};

type RouterModelEntry = {
  id?: unknown;
  status?: {
    value?: unknown;
    args?: unknown;
    failed?: unknown;
    exit_code?: unknown;
  };
};

const MODEL_STATE_VALUES = new Set<string>(['unloaded', 'loading', 'loaded', 'sleeping']);

/**
 * Parses a GET /models payload (b9244: data[] entries with id and
 * status: {value, args?, failed?, exit_code?}). Tolerant to missing fields and
 * unknown status values (mapped to 'unloaded'); `failed: true` always wins over
 * the reported status value. The synthetic `default` entry (whose args carry no
 * `--model`) is dropped; entries without `--model` in status.args are dropped
 * the same way. `port` is only reported when positive — unloaded entries carry
 * `--port 0`.
 */
export function parseLlamaCppRouterModelsPayload(payload: unknown): LlamaCppRouterModelSnapshot[] {
  const entries = (payload as RouterModelsPayload | null | undefined)?.data;
  if (!Array.isArray(entries)) return [];

  const snapshots: LlamaCppRouterModelSnapshot[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const model = entry as RouterModelEntry;
    const id = typeof model.id === 'string' ? model.id.trim() : '';
    if (!id) continue;
    if ((LLAMACPP_ROUTER_SYNTHETIC_MODEL_IDS as readonly string[]).includes(id)) continue;

    const status = model.status ?? {};
    const modelPath = findFlagStringValue(status.args, '--model');
    if (!modelPath) continue;

    const failed = status.failed === true;
    const value = typeof status.value === 'string' ? status.value : '';
    const state: LlamaCppRouterModelState = failed
      ? 'failed'
      : MODEL_STATE_VALUES.has(value)
        ? (value as LlamaCppRouterModelState)
        : 'unloaded';

    const port = findFlagNumberValue(status.args, '--port');
    snapshots.push({
      id,
      state,
      modelPath,
      ...(typeof status.exit_code === 'number' ? { exitCode: status.exit_code } : {}),
      ...(port !== undefined && port > 0 ? { port } : {}),
    });
  }
  return snapshots;
}

/** Parses GET /slots?model=X (array of slots with is_processing). Fails safe to busy. */
export function parseLlamaCppRouterSlotsPayload(payload: unknown): LlamaCppRouterModelSlots {
  if (!Array.isArray(payload)) return LLAMACPP_ROUTER_SLOTS_BUSY_UNKNOWN;

  let processingSlots = 0;
  let totalSlots = 0;
  for (const slot of payload) {
    if (!slot || typeof slot !== 'object') continue;
    totalSlots += 1;
    if ((slot as { is_processing?: unknown }).is_processing === true) {
      processingSlots += 1;
    }
  }
  return {
    busy: processingSlots > 0,
    processingSlots,
    totalSlots,
  };
}

function findFlagStringValue(args: unknown, flag: string): string | undefined {
  const raw = findArgValue(args, flag);
  if (raw === undefined) return undefined;
  const trimmed = String(raw).trim();
  return trimmed || undefined;
}

function findFlagNumberValue(args: unknown, flag: string): number | undefined {
  const raw = findArgValue(args, flag);
  if (raw === undefined) return undefined;
  const parsed = Number.parseInt(String(raw).trim(), 10);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 65535 ? parsed : undefined;
}

/** Reads the value after `flag`, or the `flag=value` inline form; undefined when absent. */
function findArgValue(args: unknown, flag: string): string | number | undefined {
  if (!Array.isArray(args)) return undefined;
  const index = args.findIndex(entry => typeof entry === 'string' && entry.trim() === flag);
  if (index !== -1) {
    const raw = args[index + 1];
    return typeof raw === 'string' || typeof raw === 'number' ? raw : undefined;
  }
  const inlinePrefix = `${flag}=`;
  for (const entry of args) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (trimmed.startsWith(inlinePrefix)) return trimmed.slice(inlinePrefix.length);
  }
  return undefined;
}
