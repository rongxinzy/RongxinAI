import {
  getMagpieModelService,
  hasMagpieModelService,
  MAGPIE_RUNTIME_API_KEY,
} from '../../magpie/modelService';
import { extractApiErrorSnippet } from '../coworkModelApi';

const COWORK_MODEL_PROBE_TIMEOUT_MS = 20000;

export async function probeCoworkModelReadiness(
  timeoutMs = COWORK_MODEL_PROBE_TIMEOUT_MS,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!hasMagpieModelService()) {
    return {
      ok: false,
      error: 'Enable the unified model service in model settings before starting a task.',
    };
  }
  let endpoint: string;
  let modelId: string;
  let body: string;
  try {
    const resolved = await getMagpieModelService().resolve();
    const gateway = new URL(resolved.gatewayUrl);
    modelId = resolved.model.id;
    const native = resolved.model.native_endpoints ?? [];
    if (native.includes('/v1/messages')) {
      endpoint = `${gateway.origin}/v1/messages`;
      body = JSON.stringify({
        model: modelId,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'Reply with ok.' }],
      });
    } else {
      endpoint = `${gateway.origin}/v1/chat/completions`;
      body = JSON.stringify({
        model: modelId,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'Reply with ok.' }],
      });
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'The model service is unavailable.',
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${MAGPIE_RUNTIME_API_KEY}`,
      },
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      const errorSnippet = extractApiErrorSnippet(errorText);
      return {
        ok: false,
        error: errorSnippet
          ? `Model validation failed (${response.status}): ${errorSnippet}`
          : `Model validation failed with status ${response.status}.`,
      };
    }

    return { ok: true };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      const timeoutSeconds = Math.ceil(timeoutMs / 1000);
      return {
        ok: false,
        error: `Model validation timed out after ${timeoutSeconds}s.`,
      };
    }
    return {
      ok: false,
      error: `Model validation failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
