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
