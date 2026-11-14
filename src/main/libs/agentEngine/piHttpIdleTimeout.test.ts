import { expect, test, vi } from 'vitest';
import { Agent, setGlobalDispatcher } from 'undici';
import {
  applyPiEmbeddedHttpIdleTimeout,
  PI_EMBEDDED_HTTP_IDLE_TIMEOUT_MS,
} from './piHttpIdleTimeout';

vi.mock('undici', () => ({ Agent: vi.fn(), setGlobalDispatcher: vi.fn() }));

test('installs the native transport idle ceiling once per process', () => {
  expect(applyPiEmbeddedHttpIdleTimeout()).toBe(true);
  expect(Agent).toHaveBeenCalledWith({
    bodyTimeout: PI_EMBEDDED_HTTP_IDLE_TIMEOUT_MS,
    headersTimeout: PI_EMBEDDED_HTTP_IDLE_TIMEOUT_MS,
  });
  expect(setGlobalDispatcher).toHaveBeenCalledOnce();
  expect(applyPiEmbeddedHttpIdleTimeout()).toBe(false);
  expect(setGlobalDispatcher).toHaveBeenCalledOnce();
});
