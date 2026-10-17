import type { PiUiEvent } from '../shared/cowork/piUiEvent';
import { StreamCoalesceLimits } from './streaming/streamLimits';

type SessionBuffer = {
  events: PiUiEvent[];
  bytes: number;
  snapshotOnly: boolean;
};

/** Per-session ring buffer for attach/replay; overflow degrades to snapshot + tail. */
export class PiUiStreamReplayBuffer {
  private readonly buffers = new Map<string, SessionBuffer>();

  observe(event: PiUiEvent): void {
    if (!event.sessionId) return;
    const sessionId = event.sessionId;
    let buffer = this.buffers.get(sessionId);
    if (!buffer) {
      buffer = { events: [], bytes: 0, snapshotOnly: false };
      this.buffers.set(sessionId, buffer);
    }
    if (buffer.snapshotOnly) {
      this.pushEvent(buffer, event);
      this.trim(buffer);
      return;
    }
    this.pushEvent(buffer, event);
    while (
      buffer.events.length > StreamCoalesceLimits.ReplayMaxChunks ||
      buffer.bytes > StreamCoalesceLimits.ReplayMaxBytes
    ) {
      const removed = buffer.events.shift();
      if (!removed) break;
      buffer.bytes -= estimateEventBytes(removed);
      buffer.snapshotOnly = true;
    }
  }

  replay(sessionId: string, afterSequence = 0): PiUiEvent[] {
    const buffer = this.buffers.get(sessionId);
    if (!buffer) return [];
    return buffer.events.filter(event => event.sequence > afterSequence);
  }

  clearSession(sessionId: string): void {
    this.buffers.delete(sessionId);
  }

  private pushEvent(buffer: SessionBuffer, event: PiUiEvent): void {
    buffer.events.push(event);
    buffer.bytes += estimateEventBytes(event);
  }

  private trim(buffer: SessionBuffer): void {
    while (
      buffer.events.length > StreamCoalesceLimits.ReplayMaxChunks ||
      buffer.bytes > StreamCoalesceLimits.ReplayMaxBytes
    ) {
      const removed = buffer.events.shift();
      if (!removed) break;
      buffer.bytes -= estimateEventBytes(removed);
    }
  }
}

const estimateEventBytes = (event: PiUiEvent): number => {
  try {
    return Buffer.byteLength(JSON.stringify(event), 'utf8');
  } catch {
    return 512;
  }
};
