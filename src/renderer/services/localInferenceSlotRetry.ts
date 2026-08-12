const LOCAL_INFERENCE_SLOT_RETRYABLE_ERROR =
  /(?:slot.*(?:busy|unavailable)|all.*slots.*busy|no.*(?:slot|sequence).*available|queue.*full)/i;

export const LOCAL_INFERENCE_SLOT_RETRY_DELAYS_MS = [500, 1_000, 2_000, 4_000] as const;

export function shouldRetryLocalInferenceSlot(error: {
  message?: string;
  statusCode?: number;
}): boolean {
  return (
    error.statusCode === 429 ||
    error.statusCode === 503 ||
    LOCAL_INFERENCE_SLOT_RETRYABLE_ERROR.test(error.message ?? '')
  );
}

export function waitForLocalInferenceSlot(delayMs: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, delayMs));
}
