import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PiAgentEventType } from './piStreamConstants';
import { PiStreamStallWatchdog, STREAM_STALL_TIMEOUT_MS } from './piStreamStallWatchdog';

describe('PiStreamStallWatchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const createWatchdog = (isSuspended: (sessionId: string) => boolean = () => false) => {
    const onStall = vi.fn();
    const watchdog = new PiStreamStallWatchdog({ isSuspended, onStall });
    return { watchdog, onStall };
  };

  it('stays quiet before any arming event', () => {
    const { watchdog, onStall } = createWatchdog();
    vi.advanceTimersByTime(STREAM_STALL_TIMEOUT_MS * 2);
    expect(onStall).not.toHaveBeenCalled();
    expect(watchdog.isArmed('session')).toBe(false);
  });

  it('fires once the timeout elapses after an arming event', () => {
    const { watchdog, onStall } = createWatchdog();
    watchdog.handleEvent('session', PiAgentEventType.MessageStart);
    expect(watchdog.isArmed('session')).toBe(true);

    vi.advanceTimersByTime(STREAM_STALL_TIMEOUT_MS - 1);
    expect(onStall).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onStall).toHaveBeenCalledTimes(1);
    expect(onStall).toHaveBeenCalledWith('session');
  });

  it('uses the two-minute default timeout', () => {
    const onStall = vi.fn();
    const watchdog = new PiStreamStallWatchdog({ isSuspended: () => false, onStall });
    watchdog.handleEvent('session', PiAgentEventType.AgentStart);
    vi.advanceTimersByTime(STREAM_STALL_TIMEOUT_MS);
    expect(onStall).toHaveBeenCalledTimes(1);
  });

  it.each([
    PiAgentEventType.AgentStart,
    PiAgentEventType.TurnStart,
    PiAgentEventType.MessageStart,
    PiAgentEventType.MessageUpdate,
    PiAgentEventType.ToolExecutionEnd,
    PiAgentEventType.AutoRetryStart,
  ])('arms on %s', eventType => {
    const { watchdog, onStall } = createWatchdog();
    watchdog.handleEvent('session', eventType);
    expect(watchdog.isArmed('session')).toBe(true);
    vi.advanceTimersByTime(STREAM_STALL_TIMEOUT_MS);
    expect(onStall).toHaveBeenCalledTimes(1);
  });

  it('resets the countdown on every processed event', () => {
    const { watchdog, onStall } = createWatchdog();
    watchdog.handleEvent('session', PiAgentEventType.TurnStart);
    // Unlisted events still prove the stream is alive and push the deadline.
    vi.advanceTimersByTime(STREAM_STALL_TIMEOUT_MS - 1);
    watchdog.handleEvent('session', 'turn_end');
    vi.advanceTimersByTime(STREAM_STALL_TIMEOUT_MS - 1);
    expect(onStall).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onStall).toHaveBeenCalledTimes(1);
  });

  it('stays disarmed while a tool executes and re-arms when it ends', () => {
    const { watchdog, onStall } = createWatchdog();
    watchdog.handleEvent('session', PiAgentEventType.MessageStart);
    watchdog.handleEvent('session', PiAgentEventType.ToolExecutionStart);
    expect(watchdog.isArmed('session')).toBe(false);

    // A long, silent bash run is normal and must not trip the watchdog.
    vi.advanceTimersByTime(STREAM_STALL_TIMEOUT_MS * 5);
    expect(onStall).not.toHaveBeenCalled();

    watchdog.handleEvent('session', PiAgentEventType.ToolExecutionEnd);
    vi.advanceTimersByTime(STREAM_STALL_TIMEOUT_MS);
    expect(onStall).toHaveBeenCalledTimes(1);
  });

  it.each([
    PiAgentEventType.ToolExecutionStart,
    PiAgentEventType.AgentEnd,
    PiAgentEventType.AgentSettled,
    PiAgentEventType.MessageEnd,
  ])('disarms on %s', eventType => {
    const { watchdog, onStall } = createWatchdog();
    watchdog.handleEvent('session', PiAgentEventType.MessageStart);
    watchdog.handleEvent('session', eventType);
    expect(watchdog.isArmed('session')).toBe(false);
    vi.advanceTimersByTime(STREAM_STALL_TIMEOUT_MS * 2);
    expect(onStall).not.toHaveBeenCalled();
  });

  it('stands down when the session is waiting on user input', () => {
    let suspended = true;
    const { watchdog, onStall } = createWatchdog(() => suspended);
    watchdog.handleEvent('session', PiAgentEventType.MessageUpdate);

    vi.advanceTimersByTime(STREAM_STALL_TIMEOUT_MS * 2);
    expect(onStall).not.toHaveBeenCalled();
    expect(watchdog.isArmed('session')).toBe(false);

    // The answered question surfaces as new Pi events, which re-arm the timer.
    watchdog.handleEvent('session', PiAgentEventType.ToolExecutionEnd);
    suspended = false;
    vi.advanceTimersByTime(STREAM_STALL_TIMEOUT_MS);
    expect(onStall).toHaveBeenCalledTimes(1);
  });

  it('fires exactly once per arming', () => {
    const { watchdog, onStall } = createWatchdog();
    watchdog.handleEvent('session', PiAgentEventType.MessageStart);
    vi.advanceTimersByTime(STREAM_STALL_TIMEOUT_MS * 3);
    expect(onStall).toHaveBeenCalledTimes(1);
    expect(watchdog.isArmed('session')).toBe(false);
  });

  it('does not fire after dispose', () => {
    const { watchdog, onStall } = createWatchdog();
    watchdog.handleEvent('session', PiAgentEventType.MessageStart);
    watchdog.dispose('session');
    vi.advanceTimersByTime(STREAM_STALL_TIMEOUT_MS * 2);
    expect(onStall).not.toHaveBeenCalled();
  });

  it('disposeAll clears every session timer', () => {
    const { watchdog, onStall } = createWatchdog();
    watchdog.handleEvent('session-a', PiAgentEventType.MessageStart);
    watchdog.handleEvent('session-b', PiAgentEventType.MessageStart);
    watchdog.disposeAll();
    vi.advanceTimersByTime(STREAM_STALL_TIMEOUT_MS * 2);
    expect(onStall).not.toHaveBeenCalled();
  });

  it('tracks sessions independently', () => {
    const { watchdog, onStall } = createWatchdog();
    watchdog.handleEvent('session-a', PiAgentEventType.MessageStart);
    vi.advanceTimersByTime(STREAM_STALL_TIMEOUT_MS / 2);
    watchdog.handleEvent('session-b', PiAgentEventType.MessageStart);
    vi.advanceTimersByTime(STREAM_STALL_TIMEOUT_MS / 2);
    expect(onStall).toHaveBeenCalledTimes(1);
    expect(onStall).toHaveBeenCalledWith('session-a');
    vi.advanceTimersByTime(STREAM_STALL_TIMEOUT_MS / 2);
    expect(onStall).toHaveBeenCalledTimes(2);
    expect(onStall).toHaveBeenLastCalledWith('session-b');
  });
});
