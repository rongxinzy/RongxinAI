export const MARKETPLACE_PAGE_SIZE = 8;
export const MARKETPLACE_MAX_PAGE_ROWS = 5;
export const MARKETPLACE_INITIAL_MODEL_COUNT = 24;
export const MARKETPLACE_SEARCH_MAX_MODEL_COUNT = 300;
export const CHAT_NEAR_BOTTOM_THRESHOLD = 96;
export const CHAT_HIDDEN_BELOW_THRESHOLD = 8;
export const ASSISTANT_SCROLL_TOP_OFFSET = 0;
export const CHAT_MANUAL_SCROLL_OVERRIDE_MS = 1200;
export const LOCAL_INFERENCE_TOAST_AUTO_DISMISS_MS = 5_000;
export const LOCAL_INFERENCE_PROGRESS_DISMISS_MS = 5_000;
export const LOCAL_INFERENCE_MODEL_LAUNCH_LOG_MAX_ENTRIES = 300;
export const LOCAL_INFERENCE_MODEL_LAUNCH_LOG_TRANSITION_MS = 450;
export const LOCAL_INFERENCE_UNLOAD_MIN_BUSY_MS = 500;
export const LOCAL_INFERENCE_UNLOAD_SETTLE_TIMEOUT_MS = 3_000;
export const LOCAL_INFERENCE_UNLOAD_SETTLE_POLL_INTERVAL_MS = 400;
export const LOCAL_INFERENCE_MIN_SPEED_SAMPLE_SECONDS = 0.05;
export const LOCAL_INFERENCE_MAX_SPEED_FOR_TINY_COMPLETION = 200;
export const LOCAL_INFERENCE_MAX_SPEED_FOR_SMALL_COMPLETION = 2000;
export const LOCAL_INFERENCE_SESSION_STORAGE_KEY = 'zhiyuan:llamacpp-inference-session';
export const LOCAL_INFERENCE_MODEL_ORDER_STORAGE_KEY = 'zhiyuan:llamacpp-model-order';
export const DIRECT_ANSWER_SYSTEM_HINT = [
  'Answer as quickly and directly as possible.',
  'Skip unnecessary drafts, long internal monologues, and unrelated exploration.',
  'If you produce thinking, keep it very short and focused before giving the final answer.',
  'Please think briefly, do not ramble, and keep any visible thinking within about 50 Chinese characters or one short sentence when possible.',
  'Focus on the necessary conditions first, then give the conclusion without drifting to unrelated topics.',
].join(' ');

export const smallOutlineButtonClass =
  'inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-xs text-foreground/80 transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50';

export const smallDangerButtonClass =
  'inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-xs text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/30';

export const localInferenceMutedTextClass = 'text-muted-foreground';
export const localInferenceSoftTextClass = 'text-foreground/75';
export const localInferencePlaceholderTextClass = 'text-foreground/45';

export const localInferenceCompactButtonClass =
  'h-8 min-w-16 cursor-pointer px-3 shadow-none transition-[background-color,border-color,box-shadow] duration-200 ease-out hover:shadow-lg hover:shadow-foreground/10 active:shadow-inset';
