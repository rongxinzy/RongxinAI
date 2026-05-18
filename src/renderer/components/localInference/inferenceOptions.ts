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
  reasoning_format: 'auto' | 'none' | 'deepseek' | 'deepseek-legacy';
  thinking_forced_open: 'auto' | 'enabled' | 'disabled';
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
  reasoning_format: 'auto',
  thinking_forced_open: 'auto',
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
  reasoning_format: 'auto',
  thinking_forced_open: 'auto',
  cache_prompt: 'auto',
};

export function loadInferenceOptions(): InferenceOptions {
  try {
    const raw = localStorage.getItem('lobsterai:llamacpp-inference-options');
    if (!raw) return DEFAULT_INFERENCE_OPTIONS;
    return { ...DEFAULT_INFERENCE_OPTIONS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_INFERENCE_OPTIONS;
  }
}

export function normalizeOptions(options: InferenceOptions): Record<string, unknown> {
  const stop = options.stop
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return {
    temperature: options.temperature,
    top_p: options.top_p,
    top_k: options.top_k,
    max_tokens: options.num_predict,
    repeat_penalty: options.repeat_penalty,
    min_p: options.min_p,
    presence_penalty: options.presence_penalty,
    ...(options.reasoning_format !== 'auto' ? { reasoning_format: options.reasoning_format } : {}),
    ...(options.thinking_forced_open === 'enabled' ? { thinking_forced_open: true } : {}),
    ...(options.thinking_forced_open === 'disabled' ? { thinking_forced_open: false } : {}),
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
    && left.reasoning_format === right.reasoning_format
    && left.thinking_forced_open === right.thinking_forced_open
    && left.cache_prompt === right.cache_prompt;
}

export function isDefaultInferenceOptions(options: InferenceOptions): boolean {
  return areInferenceOptionsEqual(options, DEFAULT_INFERENCE_OPTIONS);
}

export function isQwen35_08BModel(modelName: string): boolean {
  const normalized = modelName.toLowerCase();
  return normalized.includes('qwen3.5-0.8b') || normalized.includes('qwen3-0.8b');
}

export function isThinkingModel(modelName: string): boolean {
  const normalized = modelName.toLowerCase();
  return /\b(deepseek-r1|qwq|qwen3|qwen-3|qwen3\.5|qwen-3\.5|gpt-oss|reasoning|think|thinking|phi4-reasoning)\b/.test(normalized)
    || normalized.includes('deepseek-r1')
    || normalized.includes('distill-qwen')
    || normalized.includes('distill-llama');
}

export function getRecommendedInferenceOptions(modelName: string): InferenceOptions {
  return isQwen35_08BModel(modelName)
    ? QWEN35_08B_INFERENCE_OPTIONS
    : DEFAULT_INFERENCE_OPTIONS;
}

export function shouldApplyModelPreset(options: InferenceOptions): boolean {
  return isDefaultInferenceOptions(options) || areInferenceOptionsEqual(options, QWEN35_08B_INFERENCE_OPTIONS);
}
