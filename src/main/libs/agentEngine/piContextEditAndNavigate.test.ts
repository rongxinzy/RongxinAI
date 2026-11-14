import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PiRuntimeAdapter } from './piRuntimeAdapter';

describe('piContextEditAndNavigate (F18)', () => {
  let adapter: PiRuntimeAdapter;
  let mockPiSession: any;
  let mockNativeEdits: any;
  let mockStore: any;
  const sessionId = 'test-session-tree';

  beforeEach(() => {
    adapter = new PiRuntimeAdapter();

    mockNativeEdits = {
      appendContextEdit: vi.fn(
        (targetId: string, _replacement: any) => `edit-entry-for-${targetId}`,
      ),
    };

    mockPiSession = {
      appendContextEdit: mockNativeEdits.appendContextEdit,
      navigateTree: vi.fn(async (targetId: string, _options?: any) => ({
        cancelled: false,
        editorText: `Rewound prompt for ${targetId}`,
      })),
    };

    mockStore = {
      getMessages: vi.fn(() => [
        { id: 'msg-1', type: 'user', content: 'Original user prompt', metadata: {} },
        { id: 'msg-2', type: 'assistant', content: 'Original assistant response', metadata: {} },
      ]),
      updateMessageMetadata: vi.fn(),
    };

    adapter.setCoworkStore(mockStore);

    (adapter as any).activeSessions.set(sessionId, {
      sessionId,
      piSession: mockPiSession,
      isRunning: false,
    });
  });

  describe('appendContextEdit', () => {
    it('appends non-destructive context masking with replacement: null', async () => {
      const result = await adapter.appendContextEdit(sessionId, 'msg-1', null);

      expect(result.success).toBe(true);
      expect(result.entryId).toBe('edit-entry-for-msg-1');
      expect(mockNativeEdits.appendContextEdit).toHaveBeenCalledWith('msg-1', null);

      // Verify store metadata updated
      expect(mockStore.updateMessageMetadata).toHaveBeenCalledWith(sessionId, 'msg-1', {
        contextEdit: { omitted: true },
      });
    });

    it('appends context replacement with content', async () => {
      const replacement = { content: 'Redacted confidential content' };
      const result = await adapter.appendContextEdit(sessionId, 'msg-2', replacement);

      expect(result.success).toBe(true);
      expect(result.entryId).toBe('edit-entry-for-msg-2');
      expect(mockNativeEdits.appendContextEdit).toHaveBeenCalledWith('msg-2', replacement);

      // Verify store metadata updated
      expect(mockStore.updateMessageMetadata).toHaveBeenCalledWith(sessionId, 'msg-2', {
        contextEdit: { replaced: true },
      });
    });

    it('refuses context editing while session is running', async () => {
      (adapter as any).activeSessions.get(sessionId)!.isRunning = true;

      const result = await adapter.appendContextEdit(sessionId, 'msg-1', null);
      expect(result.success).toBe(false);
      expect(result.error).toContain('running');
      expect(mockNativeEdits.appendContextEdit).not.toHaveBeenCalled();
    });

    it('returns error when session is not found', async () => {
      const result = await adapter.appendContextEdit('non-existent', 'msg-1', null);
      expect(result.success).toBe(false);
      expect(result.error).toContain('not active');
    });
  });

  describe('navigateSessionTree', () => {
    it('navigates tree and emits sessionsChanged event when idle', async () => {
      const eventSpy = vi.fn();
      adapter.on('sessionsChanged', eventSpy);

      const result = await adapter.navigateSessionTree(sessionId, 'msg-1', {
        summarize: true,
        label: 'Rewind checkpoint',
      });

      expect(result.success).toBe(true);
      expect(result.editorText).toBe('Rewound prompt for msg-1');
      expect(mockPiSession.navigateTree).toHaveBeenCalledWith('msg-1', {
        summarize: true,
        label: 'Rewind checkpoint',
      });
      expect(eventSpy).toHaveBeenCalledTimes(1);
    });

    it('refuses tree navigation while session is running', async () => {
      (adapter as any).activeSessions.get(sessionId)!.isRunning = true;

      const result = await adapter.navigateSessionTree(sessionId, 'msg-1');
      expect(result.success).toBe(false);
      expect(result.error).toContain('running');
      expect(mockPiSession.navigateTree).not.toHaveBeenCalled();
    });

    it('handles cancelled tree navigation gracefully', async () => {
      mockPiSession.navigateTree.mockResolvedValueOnce({
        cancelled: true,
      });

      const result = await adapter.navigateSessionTree(sessionId, 'msg-1');
      expect(result.success).toBe(false);
      expect(result.cancelled).toBe(true);
    });
  });
});
