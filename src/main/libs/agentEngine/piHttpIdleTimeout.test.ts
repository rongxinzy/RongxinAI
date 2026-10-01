import { expect, test, vi } from 'vitest';
import { setGlobalDispatcher } from 'undici';
import {
  applyPiEmbeddedHttpIdleTimeout,
  PI_EMBEDDED_HTTP_IDLE_TIMEOUT_MS,
} from './piHttpIdleTimeout';

vi.mock('undici', () => ({
  Agent: vi.fn(),
  setGlobalDispatcher: vi.fn(),
}));

test('raises the settings manager timeout and installs the global dispatcher once', () => {
  const setHttpIdleTimeoutMs = vi.fn();

  expect(applyPiEmbeddedHttpIdleTimeout({ setHttpIdleTimeoutMs })).toBe(true);
  expect(setHttpIdleTimeoutMs).toHaveBeenCalledWith(PI_EMBEDDED_HTTP_IDLE_TIMEOUT_MS);
  expect(setGlobalDispatcher).toHaveBeenCalledOnce();

  // Later sessions reconfigure their own settings manager but must not
  // replace the process-wide dispatcher again.
  expect(applyPiEmbeddedHttpIdleTimeout(null)).toBe(false);
  expect(setGlobalDispatcher).toHaveBeenCalledOnce();
});
