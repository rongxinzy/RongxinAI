import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PiAgentSettleFallback, AGENT_SETTLE_FALLBACK_MS } from './piAgentSettleFallback';
import { PiAgentEventType } from './piStreamConstants';

describe('PiAgentSettleFallback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires when no event follows agent_end within the window', () => {
    const onSettle = vi.fn();
    const fallback = new PiAgentSettleFallback(onSettle);
    fallback.arm('session');
    expect(fallback.isArmed('session')).toBe(true);

    vi.advanceTimersByTime(AGENT_SETTLE_FALLBACK_MS - 1);
    expect(onSettle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onSettle).toHaveBeenCalledTimes(1);
    expect(onSettle).toHaveBeenCalledWith('session');
    expect(fallback.isArmed('session')).toBe(false);
  });

  it('agent_settled cancels the fallback before it fires', () => {
    const onSettle = vi.fn();
    const fallback = new PiAgentSettleFallback(onSettle);
    fallback.arm('session');
    fallback.handleEvent('session', PiAgentEventType.AgentSettled);
    expect(fallback.isArmed('session')).toBe(false);
    vi.advanceTimersByTime(AGENT_SETTLE_FALLBACK_MS * 2);
    expect(onSettle).not.toHaveBeenCalled();
  });

  it.each([
    PiAgentEventType.CompactionStart,
    PiAgentEventType.CompactionEnd,
    PiAgentEventType.TurnStart,
    PiAgentEventType.MessageStart,
    PiAgentEventType.ToolExecutionStart,
    PiAgentEventType.AutoRetryStart,
  ])('a continuation event (%s) cancels the fallback', eventType => {
    const onSettle = vi.fn();
    const fallback = new PiAgentSettleFallback(onSettle);
    fallback.arm('session');
    fallback.handleEvent('session', eventType);
    vi.advanceTimersByTime(AGENT_SETTLE_FALLBACK_MS * 2);
    expect(onSettle).not.toHaveBeenCalled();
  });

  it('agent_end itself does not cancel the fallback', () => {
    const onSettle = vi.fn();
    const fallback = new PiAgentSettleFallback(onSettle);
    fallback.arm('session');
    fallback.handleEvent('session', PiAgentEventType.AgentEnd);
    expect(fallback.isArmed('session')).toBe(true);
  });

  it('does not fire after dispose', () => {
    const onSettle = vi.fn();
    const fallback = new PiAgentSettleFallback(onSettle);
    fallback.arm('session');
    fallback.dispose('session');
    vi.advanceTimersByTime(AGENT_SETTLE_FALLBACK_MS * 2);
    expect(onSettle).not.toHaveBeenCalled();
  });

  it('disposeAll clears every session timer', () => {
    const onSettle = vi.fn();
    const fallback = new PiAgentSettleFallback(onSettle);
    fallback.arm('session-a');
    fallback.arm('session-b');
    fallback.disposeAll();
    vi.advanceTimersByTime(AGENT_SETTLE_FALLBACK_MS * 2);
    expect(onSettle).not.toHaveBeenCalled();
  });
});
