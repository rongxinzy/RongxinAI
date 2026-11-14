import { expect, test, vi } from 'vitest';
import { fauxProvider, fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import { DurableSession } from './durableSession.mjs';
import { DurableModelCatalog } from './durableModelCatalog.mjs';
import { cancelPiRetry, waitForPiRetryCancellation } from './piRetryCancellation';

test('cancels native persisted backoff and admits the next input without an outer retry loop', async () => {
  const faux = fauxProvider();
  const catalog = new DurableModelCatalog();
  catalog.models.setProvider(faux.provider);
  faux.setResponses([
    fauxAssistantMessage([], { stopReason: 'error', errorMessage: '503 service unavailable' }),
    fauxAssistantMessage('Recovered.'),
  ]);
  const session = await DurableSession.open({
    cwd: process.cwd(),
    model: faux.getModel() as unknown as Record<string, unknown>,
    modelRuntime: catalog,
    noTools: 'all',
    settings: { retry: { enabled: true, maxRetries: 3, baseDelayMs: 60_000 } },
  });
  let cancellation: Promise<void> | undefined;
  session.subscribe(event => {
    if (event.type === 'auto_retry_start' && !cancellation) cancellation = cancelPiRetry(session);
  });
  try {
    const started = Date.now();
    await session.prompt('First input.');
    await cancellation;
    expect(cancellation).toBeDefined();
    expect(Date.now() - started).toBeLessThan(5000);
    expect(faux.state.callCount).toBe(1);
    await session.prompt('Second input.');
    expect(faux.state.callCount).toBe(2);
  } finally {
    await session.close();
  }
});

test('deduplicates cancellation and holds continuations until abort finishes', async () => {
  let finishAbort: (() => void) | undefined;
  const session = {
    abort: vi.fn(
      () =>
        new Promise<void>(resolve => {
          finishAbort = resolve;
        }),
    ),
  };
  const cancellation = cancelPiRetry(session);
  expect(cancelPiRetry(session)).toBe(cancellation);
  let ready = false;
  const continuation = waitForPiRetryCancellation(session)!.then(() => {
    ready = true;
  });
  await Promise.resolve();
  expect(ready).toBe(false);
  expect(session.abort).toHaveBeenCalledOnce();
  finishAbort!();
  await continuation;
  expect(ready).toBe(true);
});
