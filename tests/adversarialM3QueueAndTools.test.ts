import * as fs from 'fs';
import * as os from 'os';
import path from 'path';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import JSZip from 'jszip';

import {
  CoworkQueueDelivery,
  CoworkQueueItemStatus,
} from '../src/shared/cowork/pendingMessageQueue';
import { ImageInputVerdict } from '../src/main/libs/agentEngine/piImageInputFallback';
import { PiRuntimeQueueController } from '../src/main/libs/agentEngine/piRuntimeQueueController';
import type { ActivePiSession } from '../src/main/libs/agentEngine/piRuntimeSessionState';
import type { PiRuntimeAdapterHost } from '../src/main/libs/agentEngine/piRuntimeAdapterHost';
import { PiRuntimeAdapter } from '../src/main/libs/agentEngine/piRuntimeAdapter';
import {
  buildPiDocumentReaderTool,
  PiDocumentReaderAnnotations,
  PiDocumentReaderOutputSchema,
  PI_DOCUMENT_READER_MAX_CHARS,
} from '../src/main/libs/agentEngine/piDocumentReaderTool';

describe('Adversarial M3 Verification: Queue Thinning, Session Stats, Context Edit, Document Reader', () => {
  describe('Integrity & Facade Checks', () => {
    it('verifies that duplicate prompt maps (pendingDirectUserPrompts, dispatchedNativeFollowUpIds) are completely removed', () => {
      const controller = new PiRuntimeQueueController({} as any);
      expect((controller as any).pendingDirectUserPrompts).toBeUndefined();
      expect((controller as any).dispatchedNativeFollowUpIds).toBeUndefined();
    });

    it('verifies DocumentReaderTool declares real annotations and output schema, not empty facades', () => {
      expect(PiDocumentReaderAnnotations.readOnlyHint).toBe(true);
      expect(PiDocumentReaderAnnotations.openWorldHint).toBe(false);
      expect(PiDocumentReaderAnnotations.idempotentHint).toBe(true);
      expect((PiDocumentReaderOutputSchema as any).properties.text).toBeDefined();
      expect((PiDocumentReaderOutputSchema as any).properties.path).toBeDefined();
    });
  });

  describe('Adversarial Document Reader Stress Tests', () => {
    const tempDirs: string[] = [];

    const makeTempDir = (): string => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adv-doc-reader-'));
      tempDirs.push(dir);
      return dir;
    };

    const makeDocx = async (filePath: string, text: string): Promise<void> => {
      const zip = new JSZip();
      zip.file(
        '[Content_Types].xml',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
      );
      zip.file(
        '_rels/.rels',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
      );
      zip.file(
        'word/document.xml',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
      );
      fs.writeFileSync(filePath, await zip.generateAsync({ type: 'nodebuffer' }));
    };

    afterEach(() => {
      for (const dir of tempDirs.splice(0)) {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      }
    });

    it('rejects path traversal attempts with isError: true and DOCUMENT_PATH_DENIED', async () => {
      const workspace = makeTempDir();
      const tool = buildPiDocumentReaderTool({ workspaceRoot: workspace });

      const attacks = [
        '../outside.docx',
        '../../etc/passwd',
        '....//....//escape.pdf',
        '/absolute/path/file.docx',
      ];

      for (const attack of attacks) {
        const result = await tool.execute('call-id', { path: attack });
        expect(result.isError).toBe(true);
        expect(result.details.errorCode).toBe('DOCUMENT_PATH_DENIED');
        expect(result.structuredContent.errorCode).toBe('DOCUMENT_PATH_DENIED');
      }
    });

    it('rejects directory targets with isError: true and DOCUMENT_PATH_DENIED (enforced by resolveWorkspaceFile)', async () => {
      const workspace = makeTempDir();
      const subDir = path.join(workspace, 'subdir');
      fs.mkdirSync(subDir);
      const tool = buildPiDocumentReaderTool({ workspaceRoot: workspace });

      const result = await tool.execute('call-id', { path: 'subdir' });
      expect(result.isError).toBe(true);
      expect(result.details.errorCode).toBe('DOCUMENT_PATH_DENIED');
      expect(result.structuredContent.errorCode).toBe('DOCUMENT_PATH_DENIED');
      expect(result.content[0].text).toContain('path must be a file inside the workspace');
    });

    it('handles immediately aborted signal before file access without throwing', async () => {
      const workspace = makeTempDir();
      await makeDocx(path.join(workspace, 'test.docx'), 'Hello World');
      const tool = buildPiDocumentReaderTool({ workspaceRoot: workspace });

      const controller = new AbortController();
      controller.abort();

      const result = await tool.execute('call-id', { path: 'test.docx' }, controller.signal);
      expect(result.isError).toBe(true);
      expect(result.details.errorCode).toBe('DOCUMENT_ABORTED');
      expect(result.content[0].text).toContain('cancelled');
    });

    it('ensures details and structuredContent always match and contain extracted text on success', async () => {
      const workspace = makeTempDir();
      const uniqueText = 'Confidential quarterly projection 2026-Q4';
      await makeDocx(path.join(workspace, 'report.docx'), uniqueText);
      const tool = buildPiDocumentReaderTool({ workspaceRoot: workspace });

      const result = await tool.execute('call-id', { path: 'report.docx' });
      expect(result.isError).toBeUndefined();
      expect(result.details.text).toContain(uniqueText);
      expect(result.structuredContent.text).toContain(uniqueText);
      expect(result.details.path).toBe('report.docx');
      expect(result.details.format).toBe('docx');
      expect(result.details.bytes).toBeGreaterThan(0);
      expect(result.details.truncated).toBe(false);
    });

    it('correctly handles non-truncated vs truncated documents at boundary limits', async () => {
      const workspace = makeTempDir();
      // Small document (not truncated)
      await makeDocx(path.join(workspace, 'short.docx'), 'Short content');
      const tool = buildPiDocumentReaderTool({ workspaceRoot: workspace });

      const shortResult = await tool.execute('call-1', { path: 'short.docx' });
      expect(shortResult.isError).toBeUndefined();
      expect(shortResult.details.truncated).toBe(false);

      // Large document (truncated to PI_DOCUMENT_READER_MAX_CHARS)
      const oversizedText = 'Z'.repeat(50_000);
      await makeDocx(path.join(workspace, 'large.docx'), oversizedText);
      const largeResult = await tool.execute('call-2', { path: 'large.docx' });
      expect(largeResult.isError).toBeUndefined();
      expect(largeResult.details.truncated).toBe(true);
      expect(largeResult.details.text?.length).toBe(PI_DOCUMENT_READER_MAX_CHARS);
      expect(largeResult.details.markdownCharacters).toBeGreaterThan(50_000);
    });
  });

  describe('Adversarial Queue Controller & State Machine Stress Tests', () => {
    let mockHost: any;
    let mockPiSession: any;
    let mockStore: any;
    let activeSession: ActivePiSession;
    let queueController: PiRuntimeQueueController;
    const sessionId = 'adv-queue-session';

    beforeEach(() => {
      mockPiSession = {
        prompt: vi.fn().mockResolvedValue(undefined),
        sendUserMessage: vi.fn().mockResolvedValue(undefined),
        clearQueue: vi.fn(() => ({ steering: [], followUp: [] })),
      };

      activeSession = {
        sessionId,
        piSession: mockPiSession,
        isRunning: true,
        aborted: false,
        abortController: new AbortController(),
        resourceState: {
          chatMode: false,
          skillIds: ['skill-core'],
          skillRoots: {},
          expertSkillDirs: [],
        },
      } as unknown as ActivePiSession;

      mockStore = {
        addMessage: vi.fn((_id: string, msg: any) => msg),
      };

      mockHost = {
        activeSessions: new Map([[sessionId, activeSession]]),
        isSessionRunning: vi.fn((id: string) => id === sessionId && activeSession.isRunning),
        isSessionActive: vi.fn((id: string) => id === sessionId && !activeSession.aborted),
        isStoredSessionWorkMode: vi.fn(() => true),
        persistImageAttachments: vi.fn((_id: string, imgs: any) => imgs),
        recovery: {
          imageInputVerdictForActive: vi.fn(() => ImageInputVerdict.Supported),
          recordImagePrompt: vi.fn(),
        },
        getOcrCommandFor: vi.fn(),
        getStore: vi.fn(() => mockStore),
        emit: vi.fn(),
        continueSession: vi.fn().mockResolvedValue(undefined),
      } as unknown as PiRuntimeAdapterHost;

      queueController = new PiRuntimeQueueController(mockHost);
    });

    it('steers middle item, clears native queue, and restores remaining items in strict FIFO order with metadata', async () => {
      const item1 = queueController.enqueuePendingMessage(
        sessionId,
        'Item 1',
        undefined,
        undefined,
        ['skill-1'],
      );
      const item2 = queueController.enqueuePendingMessage(sessionId, 'Item 2 to steer', [
        { name: 'img.png', mimeType: 'image/png', base64Data: 'abc' },
      ]);
      const item3 = queueController.enqueuePendingMessage(sessionId, 'Item 3', undefined, [
        { name: 'doc.txt', path: '/doc.txt', extension: 'TXT' },
      ]);

      expect(item1.success && item2.success && item3.success).toBe(true);
      expect(queueController.list(sessionId)).toHaveLength(3);

      mockPiSession.clearQueue.mockClear();
      mockPiSession.sendUserMessage.mockClear();
      mockPiSession.prompt.mockClear();

      // Steer item 2
      const steerResult = await queueController.steerPendingMessage(sessionId, item2.item!.id);
      expect(steerResult.success).toBe(true);

      // Verify native queue was cleared
      expect(mockPiSession.clearQueue).toHaveBeenCalledTimes(1);

      // Verify steer prompt was dispatched with image
      expect(mockPiSession.sendUserMessage).toHaveBeenCalledWith(expect.anything(), {
        deliverAs: 'steer',
      });

      // Verify remaining items (item 1, item 3) were re-enqueued in order
      const remaining = queueController.list(sessionId);
      expect(remaining).toHaveLength(2);
      expect(remaining[0].id).toBe(item1.item!.id);
      expect(remaining[1].id).toBe(item3.item!.id);
    });

    it('recovers sidecar state and re-enqueues follow-ups when native steer dispatch rejects', async () => {
      const item1 = queueController.enqueuePendingMessage(sessionId, 'Follow-up 1');
      const item2 = queueController.enqueuePendingMessage(sessionId, 'Follow-up 2');

      // Make next prompt fail
      mockPiSession.prompt.mockRejectedValueOnce(new Error('Steer rejected by LLM pipeline'));

      const steerResult = await queueController.steerPendingMessage(sessionId, item1.item!.id);
      expect(steerResult.success).toBe(false);
      expect(steerResult.error).toContain('Steer rejected by LLM pipeline');

      // item1 should be restored with Failed status
      const list = queueController.list(sessionId);
      expect(list).toHaveLength(2);
      const restored1 = list.find(i => i.id === item1.item!.id);
      expect(restored1?.status).toBe(CoworkQueueItemStatus.Failed);
      expect(restored1?.error).toContain('Steer rejected');
    });

    it('drops queued control actions when turnFailed is set, preventing stale control execution', async () => {
      let controlActionExecuted = false;
      queueController.enqueueControlAction(sessionId, async () => {
        controlActionExecuted = true;
      });

      expect(queueController.hasQueuedControlActions(sessionId)).toBe(true);

      activeSession.isRunning = false;
      activeSession.turnFailed = true;

      await queueController.flushFollowUpQueue(sessionId, activeSession);

      expect(controlActionExecuted).toBe(false);
      expect(queueController.hasQueuedControlActions(sessionId)).toBe(false);
    });
  });

  describe('Adversarial Context Edit, Tree Navigation, & Session Stats', () => {
    let adapter: PiRuntimeAdapter;
    let mockPiSession: any;
    let mockSessionManager: any;
    let mockStore: any;
    const sessionId = 'adv-tree-stats-session';

    beforeEach(() => {
      adapter = new PiRuntimeAdapter();

      mockSessionManager = {
        appendContextEdit: vi.fn((targetId: string, _replacement: any) => `entry-${targetId}`),
      };

      mockPiSession = {
        sessionManager: mockSessionManager,
        navigateTree: vi.fn(async (targetId: string) => ({
          cancelled: false,
          editorText: `Branch at ${targetId}`,
        })),
        getSessionStats: vi.fn(() => ({
          sessionId,
          tokens: { input: 1000, output: 250, total: 1250 },
          cost: 0.015,
        })),
      };

      mockStore = {
        updateMessageMetadata: vi.fn(),
        getMessages: vi.fn(() => []),
      };

      adapter.setCoworkStore(mockStore);

      (adapter as any).activeSessions.set(sessionId, {
        sessionId,
        piSession: mockPiSession,
        isRunning: false,
      });
    });

    it('rejects appendContextEdit and navigateSessionTree if session is busy running', async () => {
      (adapter as any).activeSessions.get(sessionId)!.isRunning = true;

      const editResult = adapter.appendContextEdit(sessionId, 'target-msg', null);
      expect(editResult.success).toBe(false);
      expect(editResult.error).toContain('running');

      const navResult = await adapter.navigateSessionTree(sessionId, 'target-msg');
      expect(navResult.success).toBe(false);
      expect(navResult.error).toContain('running');

      expect(mockSessionManager.appendContextEdit).not.toHaveBeenCalled();
      expect(mockPiSession.navigateTree).not.toHaveBeenCalled();
    });

    it('handles navigateSessionTree failure exceptions without crashing the adapter', async () => {
      mockPiSession.navigateTree.mockRejectedValueOnce(new Error('Corrupt JSONL entry'));

      const result = await adapter.navigateSessionTree(sessionId, 'target-msg');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Corrupt JSONL entry');
    });

    it('retrieves session stats directly from Pi native runtime without synthetic fabrication', () => {
      const stats = adapter.getSessionStats(sessionId);
      expect(stats).toBeDefined();
      expect(stats?.tokens.total).toBe(1250);
      expect(stats?.cost).toBe(0.015);
      expect(mockPiSession.getSessionStats).toHaveBeenCalledTimes(1);
    });
  });
});
