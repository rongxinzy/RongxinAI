import { createHash } from 'crypto';

/**
 * Per-session fingerprint of the last injected project memory block.
 *
 * The block is prepended to the user prompt, so within one live Pi transcript
 * re-injecting an unchanged block is pure token waste. A fresh transcript
 * (session start, rebuild, or eviction restore) must call `reset` first so the
 * next turn injects again.
 */
export class MemoryInjectionDedup {
  private readonly lastInjectedHashBySessionId = new Map<string, string>();

  /**
   * Returns the block to prepend for this turn, or null when the block is
   * empty or identical to the one already injected into the live transcript.
   * Empty blocks never update the fingerprint.
   */
  take(sessionId: string, memoryContext: string): string | null {
    if (!memoryContext) return null;
    const hash = createHash('sha256').update(memoryContext).digest('hex');
    if (this.lastInjectedHashBySessionId.get(sessionId) === hash) return null;
    this.lastInjectedHashBySessionId.set(sessionId, hash);
    return memoryContext;
  }

  /** Forget a session whose transcript was dropped or deleted. */
  reset(sessionId: string): void {
    this.lastInjectedHashBySessionId.delete(sessionId);
  }
}
