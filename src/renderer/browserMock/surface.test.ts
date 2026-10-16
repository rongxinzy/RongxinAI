import { test, expect } from 'vitest';

import { browserMockElectron } from './index';
import { createGeneratedSurface } from './generated/surface';
import { createBrowserMockRuntime } from './runtime';
import { PiUiEventType } from '../../shared/cowork/piUiEvent';

test('unimplemented methods warn once and resolve a typed default', async () => {
  const runtime = createBrowserMockRuntime();
  const api = createGeneratedSurface(runtime);
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (message?: unknown) => {
    warnings.push(String(message));
  };
  try {
    const first = await api.log.getPath();
    const second = await api.log.getPath();
    expect(first).toBe('');
    expect(second).toBe('');
    expect(warnings).toEqual([
      '[Browser Mock] log.getPath is not implemented; returning a typed default',
    ]);
    const catalog = await api.magpie.catalog();
    expect(catalog.status.state).toBeTruthy();
  } finally {
    console.warn = original;
  }
});

test('event subscriptions deliver payloads and unsubscribe', () => {
  const runtime = createBrowserMockRuntime();
  const api = createGeneratedSurface(runtime);
  let seen = 0;
  const unsubscribe = api.cowork.onStreamUiEvent(() => {
    seen += 1;
  });
  runtime.emit('cowork.onStreamUiEvent', { type: PiUiEventType.Completed });
  expect(seen).toBe(1);
  unsubscribe();
  runtime.emit('cowork.onStreamUiEvent', { type: PiUiEventType.Completed });
  expect(seen).toBe(1);
});

test('continuing a fixture session streams a mock reply', async () => {
  const types: string[] = [];
  browserMockElectron.cowork.onStreamUiEvent(event => {
    if (event.sessionId === 'session-1') types.push(event.type);
  });
  const result = await browserMockElectron.cowork.continueSession({
    sessionId: 'session-1',
    prompt: 'Add a percent key',
  });
  expect(result.success).toBe(true);
  await new Promise(resolve => {
    setTimeout(resolve, 400);
  });
  expect(types).toContain(PiUiEventType.Started);
  expect(types).toContain(PiUiEventType.MessageUpdate);
  expect(types).toContain(PiUiEventType.Completed);
});
