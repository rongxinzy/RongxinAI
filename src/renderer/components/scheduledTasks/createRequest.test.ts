import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  consumeScheduledTaskCreateRequest,
  requestScheduledTaskCreate,
  subscribeScheduledTaskCreateRequest,
} from './createRequest';

let unsubscribe: (() => void) | undefined;

afterEach(() => {
  // The module is a single slot plus a listener set; reset both so cases cannot
  // influence each other.
  unsubscribe?.();
  unsubscribe = undefined;
  consumeScheduledTaskCreateRequest();
});

describe('scheduled task create request handoff', () => {
  test('parks a request until a listener arrives', () => {
    requestScheduledTaskCreate({ workspaceId: 'ws-1' });

    const listener = vi.fn();
    unsubscribe = subscribeScheduledTaskCreateRequest(listener);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith({ workspaceId: 'ws-1' });
    // Flushing consumes the slot: a later mount must not replay the request.
    expect(consumeScheduledTaskCreateRequest()).toBeNull();
  });

  test('delivers straight to a mounted listener', () => {
    const listener = vi.fn();
    unsubscribe = subscribeScheduledTaskCreateRequest(listener);

    requestScheduledTaskCreate({ workspaceId: 'ws-2' });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith({ workspaceId: 'ws-2' });
    expect(consumeScheduledTaskCreateRequest()).toBeNull();
  });

  test('stops delivering after unsubscribe', () => {
    const listener = vi.fn();
    const stop = subscribeScheduledTaskCreateRequest(listener);
    stop();

    requestScheduledTaskCreate({ workspaceId: 'ws-3' });

    expect(listener).not.toHaveBeenCalled();
    // With no listener the request is parked again for the next mount.
    expect(consumeScheduledTaskCreateRequest()).toEqual({ workspaceId: 'ws-3' });
  });

  test('keeps the latest request and allows a request without a folder', () => {
    requestScheduledTaskCreate({ workspaceId: 'ws-old' });
    requestScheduledTaskCreate();

    expect(consumeScheduledTaskCreateRequest()).toEqual({});
    expect(consumeScheduledTaskCreateRequest()).toBeNull();
  });
});
