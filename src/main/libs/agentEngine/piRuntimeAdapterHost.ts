/**
 * Host contract for the PiRuntimeAdapter's extracted session modules.
 *
 * The adapter owns the session lifecycle and cross-cutting services; the
 * launch/continuation/custom-tools/queue modules implement individual turns
 * against this interface instead of the concrete class. Types only — no
 * runtime dependency on the adapter, so modules can never import it back.
 */

import type { CoworkInterruptionCause } from '../../../shared/cowork/interruption';
import type { CoworkStore } from '../../coworkStore';
import type { ConversationHistoryService } from '../../conversationHistory/service';
import type { MemoryInjectionDedup } from '../../memory/memoryInjectionDedup';
import type { ProjectMemoryService } from '../../memory/projectMemoryService';
import type { SessionMemoryCompletion } from '../../memory/sessionMemoryExtractor';
import type { ScheduledTaskService } from '../../../scheduledTask/scheduledTaskService';
import type { WorkbenchTaskService } from '../../workbenchTask/taskService';
import type { McpServerManager } from '../mcpServerManager';
import type { PiAssistantTranscript } from './piAssistantTranscript';
import type { PiCadViewerService } from './piCadViewerTool';
import type { PiRuntimeQueueController } from './piRuntimeQueueController';
import type { PiRuntimeTurnEvents } from './piRuntimeTurnEvents';
import type { PiRuntimeTurnRecovery } from './piRuntimeTurnRecovery';
import type { ActivePiSession, InitializingPiSession } from './piRuntimeSessionState';
import type { PiContinueOptions, PiStartOptions } from './piRuntimeTypes';

export interface PiRuntimeAdapterHost {
  /** Live Pi sessions, keyed by Cowork session id. */
  readonly activeSessions: Map<string, ActivePiSession>;
  /** Sessions still creating their Pi counterpart; abortable by id. */
  readonly initializingSessions: Map<string, InitializingPiSession>;
  /** Stopped sessions that must still look active to IM routing. */
  readonly retainedSessionIds: Set<string>;
  /** Per-session dedup fingerprints for injected project-memory blocks. */
  readonly memoryInjectionDedup: MemoryInjectionDedup;
  /** Shared CAD viewer backend for the text-to-cad skill tool. */
  readonly cadViewerService: PiCadViewerService;
  /** Deferred-error and ask-user/coding-elicitation coordination. */
  readonly recovery: PiRuntimeTurnRecovery;
  /** Ordered projection of Pi events into Cowork transcript updates. */
  readonly turnEvents: PiRuntimeTurnEvents;
  /** Pending-message queue and control-action runtime. */
  readonly queue: PiRuntimeQueueController;
  /** Throttled Cowork transcript writes for assistant/thinking/tool messages. */
  readonly transcript: PiAssistantTranscript;

  // Late-bound services, injected through the adapter's setters.
  getStore(): CoworkStore | null;
  getWorkbenchTaskService(): WorkbenchTaskService | null;
  getProjectMemoryService(): ProjectMemoryService | null;
  getConversationHistoryService(): ConversationHistoryService | null;
  getScheduledTaskService(): ScheduledTaskService | null;
  getMcpServerManager(): McpServerManager | null;
  getMcpToolManifestGeneration(): number;
  getOcrCommandFor(): ((imagePath: string) => string) | undefined;

  // Session-scoped helpers implemented by the adapter.
  getSessionMemoryCompletion(sessionId: string): SessionMemoryCompletion | null;
  resolveBundledMemberProfiles(
    presetId: string,
  ): Array<{ id: string; description: string; systemPrompt: string }> | null;
  getPiAgentsDir(): string;
  persistImageAttachments(
    sessionId: string,
    attachments: PiStartOptions['imageAttachments'],
  ): PiStartOptions['imageAttachments'];

  // Lifecycle operations the extracted modules call back into.
  evictIdleSessions(): void;
  stopActiveSession(
    sessionId: string,
    reason: string,
    drainQueuedFollowUp: boolean,
    cause?: CoworkInterruptionCause,
  ): void;
  disposeSessionForRecreation(sessionId: string, active: ActivePiSession): void;
  startSession(sessionId: string, prompt: string, options?: PiStartOptions): Promise<void>;
  continueSession(sessionId: string, prompt: string, options?: PiContinueOptions): Promise<void>;
  isSessionActive(sessionId: string): boolean;
  isSessionRunning(sessionId: string): boolean;
  /** Stored-session fallback for queue gates when no live session exists. */
  isStoredSessionWorkMode(sessionId: string): boolean;

  emit(event: string, ...args: unknown[]): void;
}
