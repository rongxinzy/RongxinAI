// Shared types and lifecycle constants for LlamaCppManager (#1069).
import type { LlamaCppBackendListResult } from '../../../shared/llamacpp';
import { LLAMACPP_RUNTIME_INSTALL_PROGRESS_ID } from '../../../shared/llamacpp';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = '8080';
const DEFAULT_CONNECTION_AND_LOAD_TIMEOUT_MS = 120_000;
const LLAMACPP_RUNNING_MODELS_DEFAULT_TIMEOUT_MS = 2_000;
const QUIT_RUNNING_MODELS_TIMEOUT_MS = 1500;
const QUIT_UNLOAD_MODEL_TIMEOUT_MS = 3000;
const LLAMACPP_RUNTIME_PROGRESS_KEY = LLAMACPP_RUNTIME_INSTALL_PROGRESS_ID;
const LLAMACPP_LAST_LOADED_MODEL_KEY = 'llamacpp_last_loaded_model';
const LLAMACPP_BACKEND_LIST_CACHE_TTL_MS = 60_000;

type RequestOptions = { signal?: AbortSignal };

type LlamaCppBackendListCacheEntry = {
  key: string;
  expiresAt: number;
  result: LlamaCppBackendListResult;
};

export type LlamaCppManagerDownstreamSurface = {
  listRunningModels(
    timeoutMs?: number,
  ): Promise<import('../../../shared/llamacpp').LlamaCppRunningModel[]>;
  stop(): Promise<import('../../../shared/llamacpp').LlamaCppStatusSnapshot>;
  start(): Promise<import('../../../shared/llamacpp').LlamaCppStatusSnapshot>;
  detect(): Promise<import('../../../shared/llamacpp').LlamaCppStatusSnapshot>;
  client(): Promise<import('../llamacppClient').LlamaCppClient>;
};

type LlamaCppManagerStorage = {
  get<T = unknown>(key: string): T | undefined;
  set<T = unknown>(key: string, value: T): void;
  delete(key: string): void;
};

export const LlamaCppManagerLifecycleEvent = {
  ModelsUnloadedForQuit: 'models-unloaded-for-quit',
  ProcessOutput: 'process-output',
} as const;

export type LlamaCppManagerLifecycleEvent =
  (typeof LlamaCppManagerLifecycleEvent)[keyof typeof LlamaCppManagerLifecycleEvent];

export const LlamaCppProcessOutputStream = {
  Stdout: 'stdout',
  Stderr: 'stderr',
} as const;

export type LlamaCppProcessOutputStream =
  (typeof LlamaCppProcessOutputStream)[keyof typeof LlamaCppProcessOutputStream];

export type LlamaCppProcessOutputEvent = {
  stream: LlamaCppProcessOutputStream;
  text: string;
  createdAt: string;
  pid?: number;
};

export type LlamaCppModelsUnloadedForQuitEvent = {
  modelNames: string[];
};
