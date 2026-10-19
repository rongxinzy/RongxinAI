import { describe, expect, test, vi } from 'vitest';

import { LiveTextStore } from './liveTextStore';

class ManualNotifyScheduler {
  private readonly pending: Array<() => void> = [];
  drain(): void {
    const batch = this.pending.splice(0, this.pending.length);
    for (const callback of batch) callback();
  }
  get size(): number {
    return this.pending.length;
  }
  readonly schedule = (callback: () => void): void => {
    this.pending.push(callback);
  };
}

describe('LiveTextStore', () => {
  test('applies deltas immediately and notifies once per scheduled frame', () => {
    const scheduler = new ManualNotifyScheduler();
    const store = new LiveTextStore(scheduler);
    const listener = vi.fn();
    store.subscribe(listener);

    store.applyChunk('m1', { type: 'text-start', id: 'p1' }, 's1');
    store.applyChunk('m1', { type: 'text-delta', id: 'p1', delta: 'Hel' }, 's1');
    store.applyChunk('m1', { type: 'text-delta', id: 'p1', delta: 'lo' }, 's1');

    // Application is synchronous: getSnapshot is fresh before any frame runs.
    expect(store.getSnapshot('m1')).toBe('Hello');
    // A batch of updates coalesces into a single scheduled notification.
    expect(scheduler.size).toBe(1);
    expect(listener).not.toHaveBeenCalled();

    scheduler.drain();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('setSnapshot replaces the base and clears streamed parts', () => {
    const scheduler = new ManualNotifyScheduler();
    const store = new LiveTextStore(scheduler);
    store.applyChunk('m1', { type: 'text-start', id: 'p1' }, 's1');
    store.applyChunk('m1', { type: 'text-delta', id: 'p1', delta: 'partial' }, 's1');

    store.setSnapshot('m1', 'authoritative base', 's1');

    expect(store.getSnapshot('m1')).toBe('authoritative base');
    // Deltas after a snapshot restart on top of the new base.
    store.applyChunk('m1', { type: 'text-delta', id: 'p1', delta: '+' }, 's1');
    expect(store.getSnapshot('m1')).toBe('authoritative base+');
  });

  test('drops malformed deltas and increments while awaiting a resync base', () => {
    const scheduler = new ManualNotifyScheduler();
    const store = new LiveTextStore(scheduler);

    store.applyChunk('m1', { type: 'text-delta', id: 'p1', delta: 7 }, 's1');
    expect(store.getSnapshot('m1')).toBeUndefined();

    store.resetSession('s1');
    store.applyChunk('m1', { type: 'text-delta', id: 'p1', delta: 'dropped' }, 's1');
    expect(store.getSnapshot('m1')).toBeUndefined();

    store.setSnapshot('m1', 'base', 's1');
    store.applyChunk('m1', { type: 'text-delta', id: 'p1', delta: 'kept' }, 's1');
    expect(store.getSnapshot('m1')).toBe('basekept');
  });
});
