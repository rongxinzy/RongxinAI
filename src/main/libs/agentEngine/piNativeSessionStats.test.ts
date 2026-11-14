import { describe, expect, it, vi } from 'vitest';
import { PiRuntimeAdapter } from './piRuntimeAdapter';

describe('piNativeSessionStats (F18)', () => {
  it('retrieves native session statistics as the single source of truth for token and cost metrics', () => {
    const mockStats = {
      sessionId: 'session-stats-test',
      sessionFile: '/path/to/session.jsonl',
      userMessages: 4,
      assistantMessages: 4,
      toolCalls: 3,
      toolResults: 3,
      totalMessages: 14,
      tokens: {
        input: 3200,
        output: 850,
        cacheRead: 1600,
        cacheWrite: 400,
        total: 6050,
      },
      cost: 0.042,
      contextUsage: {
        tokens: 3200,
        contextWindow: 32768,
        percent: 9.76,
      },
    };

    const mockPiSession = {
      getSessionStats: vi.fn(() => mockStats),
    };

    const adapter = new PiRuntimeAdapter();
    (adapter as any).activeSessions.set('session-stats-test', {
      sessionId: 'session-stats-test',
      piSession: mockPiSession,
      isRunning: false,
    });

    const stats = adapter.getSessionStats('session-stats-test');

    expect(stats).not.toBeNull();
    expect(stats?.tokens.input).toBe(3200);
    expect(stats?.tokens.output).toBe(850);
    expect(stats?.tokens.cacheRead).toBe(1600);
    expect(stats?.tokens.cacheWrite).toBe(400);
    expect(stats?.tokens.total).toBe(6050);
    expect(stats?.cost).toBe(0.042);
    expect(stats?.userMessages).toBe(4);
    expect(stats?.assistantMessages).toBe(4);
    expect(stats?.toolCalls).toBe(3);
    expect(mockPiSession.getSessionStats).toHaveBeenCalledTimes(1);
  });

  it('returns null when the session is not active or does not implement getSessionStats', () => {
    const adapter = new PiRuntimeAdapter();

    expect(adapter.getSessionStats('non-existent')).toBeNull();

    (adapter as any).activeSessions.set('inactive-session', {
      sessionId: 'inactive-session',
      piSession: {},
    });
    expect(adapter.getSessionStats('inactive-session')).toBeNull();
  });
});
