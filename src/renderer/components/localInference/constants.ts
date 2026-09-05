export const MARKETPLACE_PAGE_SIZE = 8;
export const MARKETPLACE_PREFETCH_PAGE_COUNT = 2;
export const MARKETPLACE_MAX_PAGE_ROWS = 4;
export const MARKETPLACE_GRID_COLUMN_COUNT = 2;
export const MARKETPLACE_GRID_ROW_GAP = 16;
export const MARKETPLACE_INITIAL_MODEL_COUNT = MARKETPLACE_PAGE_SIZE;
export const MARKETPLACE_SEARCH_MAX_MODEL_COUNT = MARKETPLACE_PAGE_SIZE;
export const LOCAL_INFERENCE_TOAST_AUTO_DISMISS_MS = 5_000;
export const LOCAL_INFERENCE_PROGRESS_DISMISS_MS = 5_000;
export const LOCAL_INFERENCE_MODEL_LAUNCH_LOG_MAX_ENTRIES = 300;
export const LOCAL_INFERENCE_MODEL_LAUNCH_LOG_TRANSITION_MS = 450;
export const LOCAL_INFERENCE_UNLOAD_MIN_BUSY_MS = 500;
export const LOCAL_INFERENCE_UNLOAD_SETTLE_TIMEOUT_MS = 3_000;
export const LOCAL_INFERENCE_UNLOAD_SETTLE_POLL_INTERVAL_MS = 400;
export const LOCAL_INFERENCE_SESSION_STORAGE_KEY = 'zhiyuan:llamacpp-inference-session';
export const LOCAL_INFERENCE_MODEL_ORDER_STORAGE_KEY = 'zhiyuan:llamacpp-model-order';
export const localInferenceMutedTextClass = 'text-muted-foreground';

export const localInferenceCompactButtonClass =
  'theme-local-compact-action min-w-16 cursor-pointer';
