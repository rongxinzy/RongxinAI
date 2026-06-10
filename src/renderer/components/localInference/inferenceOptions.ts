export type InferenceOptions = {
  temperature: number;
  top_p: number;
  top_k: number;
  num_predict: number;
  repeat_penalty: number;
  seed: number;
  stop: string;
  min_p: number;
  presence_penalty: number;
  reasoning_preference: 'low' | 'auto' | 'high';
  cache_prompt: 'auto' | 'enabled' | 'disabled';
};

export const DEFAULT_INFERENCE_OPTIONS: InferenceOptions = {
  temperature: 0.7,
  top_p: 0.9,
  top_k: 40,
  num_predict: 1024,
  repeat_penalty: 1.1,
  seed: -1,
  stop: '',
  min_p: 0.05,
  presence_penalty: 0,
  reasoning_preference: 'auto',
  cache_prompt: 'auto',
};

const QWEN35_08B_INFERENCE_OPTIONS: InferenceOptions = {
  temperature: 0.3,
  top_p: 0.8,
  top_k: 20,
  num_predict: 1024,
  repeat_penalty: 1.05,
  seed: -1,
  stop: '',
  min_p: 0.05,
  presence_penalty: 0.6,
  reasoning_preference: 'auto',
  cache_prompt: 'auto',
};

export function loadInferenceOptions(): InferenceOptions {
  try {
    const raw = localStorage.getItem('lobsterai:llamacpp-inference-options');
    if (!raw) return DEFAULT_INFERENCE_OPTIONS;
    return sanitizeInferenceOptions({ ...DEFAULT_INFERENCE_OPTIONS, ...JSON.parse(raw) });
  } catch {
    return DEFAULT_INFERENCE_OPTIONS;
  }
}

export function normalizeOptions(options: InferenceOptions): Record<string, unknown> {
  const stop = options.stop
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const enableThinking =
    options.reasoning_preference === 'low'
      ? false
      : options.reasoning_preference === 'high'
        ? true
        : undefined;
  return {
    temperature: options.temperature,
    top_p: options.top_p,
    top_k: options.top_k,
    max_tokens: options.num_predict,
    repeat_penalty: options.repeat_penalty,
    min_p: options.min_p,
    presence_penalty: options.presence_penalty,
    ...(enableThinking !== undefined
      ? { chat_template_kwargs: { enable_thinking: enableThinking } }
      : {}),
    ...(options.cache_prompt === 'enabled' ? { cache_prompt: true } : {}),
    ...(options.cache_prompt === 'disabled' ? { cache_prompt: false } : {}),
    ...(options.seed >= 0 ? { seed: options.seed } : {}),
    ...(stop.length > 0 ? { stop } : {}),
  };
}

export function areInferenceOptionsEqual(left: InferenceOptions, right: InferenceOptions): boolean {
  return left.temperature === right.temperature
    && left.top_p === right.top_p
    && left.top_k === right.top_k
    && left.num_predict === right.num_predict
    && left.repeat_penalty === right.repeat_penalty
    && left.seed === right.seed
    && left.stop === right.stop
    && left.min_p === right.min_p
    && left.presence_penalty === right.presence_penalty
    && left.reasoning_preference === right.reasoning_preference
    && left.cache_prompt === right.cache_prompt;
}

export function isDefaultInferenceOptions(options: InferenceOptions): boolean {
  return areInferenceOptionsEqual(options, DEFAULT_INFERENCE_OPTIONS);
}

export function isQwen35_08BModel(modelName: string): boolean {
  const normalized = modelName.toLowerCase();
  return normalized.includes('qwen3.5-0.8b') || normalized.includes('qwen3-0.8b');
}

export function getRecommendedInferenceOptions(modelName: string): InferenceOptions {
  return isQwen35_08BModel(modelName)
    ? QWEN35_08B_INFERENCE_OPTIONS
    : DEFAULT_INFERENCE_OPTIONS;
}

export function shouldApplyModelPreset(options: InferenceOptions): boolean {
  return isDefaultInferenceOptions(options) || areInferenceOptionsEqual(options, QWEN35_08B_INFERENCE_OPTIONS);
}

function sanitizeInferenceOptions(options: Record<string, unknown>): InferenceOptions {
  return {
    temperature:
      typeof options.temperature === 'number'
        ? options.temperature
        : DEFAULT_INFERENCE_OPTIONS.temperature,
    top_p: typeof options.top_p === 'number' ? options.top_p : DEFAULT_INFERENCE_OPTIONS.top_p,
    top_k: typeof options.top_k === 'number' ? options.top_k : DEFAULT_INFERENCE_OPTIONS.top_k,
    num_predict:
      typeof options.num_predict === 'number'
        ? options.num_predict
        : DEFAULT_INFERENCE_OPTIONS.num_predict,
    repeat_penalty:
      typeof options.repeat_penalty === 'number'
        ? options.repeat_penalty
        : DEFAULT_INFERENCE_OPTIONS.repeat_penalty,
    seed: typeof options.seed === 'number' ? options.seed : DEFAULT_INFERENCE_OPTIONS.seed,
    stop: typeof options.stop === 'string' ? options.stop : DEFAULT_INFERENCE_OPTIONS.stop,
    min_p: typeof options.min_p === 'number' ? options.min_p : DEFAULT_INFERENCE_OPTIONS.min_p,
    presence_penalty:
      typeof options.presence_penalty === 'number'
        ? options.presence_penalty
        : DEFAULT_INFERENCE_OPTIONS.presence_penalty,
    reasoning_preference:
      options.reasoning_preference === 'low'
      || options.reasoning_preference === 'auto'
      || options.reasoning_preference === 'high'
        ? options.reasoning_preference
        : DEFAULT_INFERENCE_OPTIONS.reasoning_preference,
    cache_prompt:
      options.cache_prompt === 'auto'
      || options.cache_prompt === 'enabled'
      || options.cache_prompt === 'disabled'
        ? options.cache_prompt
        : DEFAULT_INFERENCE_OPTIONS.cache_prompt,
  };
}
