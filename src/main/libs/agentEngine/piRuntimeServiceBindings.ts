/** Late-bound services shared by the single Pi execution adapter. */
import { EventEmitter } from 'node:events';
import * as os from 'node:os';
import path from 'node:path';
import { CoworkSessionMode } from '../../../shared/cowork/constants';
import { persistCoworkImageAttachments } from '../../coworkImageAttachments';
import type { CoworkStore } from '../../coworkStore';
import type { ArtifactLedger } from '../../artifactLedger/artifactLedger';
import type { ConversationHistoryService } from '../../conversationHistory/service';
import type { ProjectMemoryService } from '../../memory/projectMemoryService';
import type { SessionSummaryBackfillService } from '../../memory/sessionSummaryBackfillService';
import type { SessionSummaryService } from '../../memory/sessionSummaryService';
import { resolveBundledPresetMembers } from '../../presetExpertSnapshot';
import type { ScheduledTaskService } from '../../../scheduledTask/scheduledTaskService';
import type { ScheduledTaskDelivery } from '../../../scheduledTask/types';
import { getSkillsRoot } from '../coworkUtil';
import type { McpServerManager } from '../mcpServerManager';
import { resolveBundledOcrHelper } from '../ocrHelper';
import { invalidatePiSessionDir } from './piSessionStore';
import type { PiStartOptions } from './piRuntimeTypes';
import { PiCompanionRuntime } from '../../companion/durableRuntime.mjs';
import { CompanionModelAssignment } from '../../companion/modelAssignment.mjs';
import { CompanionProfiles, type CompanionProfileStore } from '../../companion/profiles';
import { getMagpieModelService } from '../../magpie/modelService';

export class PiRuntimeServiceBindings extends EventEmitter {
  private companionStore: CompanionProfileStore | null = null;
  private companions: { profiles: CompanionProfiles; runtime: PiCompanionRuntime } | null = null;

  setCompanionStore(store: CompanionProfileStore): void {
    this.companionStore = store;
  }

  /** The unified adapter owns the companion backend; renderer windows never execute models. */
  getCompanions() {
    if (!this.companions) {
      if (!this.companionStore || !this.piSessionStoreRoot)
        throw new Error('Companion persistence is not initialized');
      this.companions = {
        profiles: new CompanionProfiles(this.companionStore),
        runtime: new PiCompanionRuntime(
          path.join(this.piSessionStoreRoot, 'companions'),
          new CompanionModelAssignment(getMagpieModelService()),
        ),
      };
    }
    return this.companions;
  }

  async closeCompanions(): Promise<void> {
    await this.companions?.runtime.close();
  }

  protected imageAttachmentRoot: string | null = null;

  protected store: CoworkStore | null = null;

  protected mcpServerManager: McpServerManager | null = null;

  protected bundledSkillsRoot: string | null = null;

  /**
   * Pi custom tools are fixed when a session is created. Bump this whenever
   * MCP discovery changes so the next user turn recreates an outdated session
   * with the current MCP proxy topology.
   */
  protected mcpToolManifestGeneration = 0;

  /** Root of per-session Pi JSONL directories (`<userData>/pi-sessions`). */
  protected piSessionStoreRoot: string | null = null;

  protected projectMemoryService: ProjectMemoryService | null = null;

  protected sessionSummaryService: SessionSummaryService | null = null;

  protected sessionSummaryBackfillService: SessionSummaryBackfillService | null = null;

  protected conversationHistoryService: ConversationHistoryService | null = null;

  protected scheduledTaskService: ScheduledTaskService | null = null;

  protected artifactLedgerService: ArtifactLedger | null = null;

  /** Bundled image-text helper; null when the platform/build cannot run it. */
  protected readonly bundledOcrHelper = resolveBundledOcrHelper();

  setCoworkStore(store: CoworkStore): void {
    this.store = store;
  }

  setImageAttachmentRoot(root: string): void {
    this.imageAttachmentRoot = root;
  }

  /**
   * Root directory for file-backed Pi sessions (`<userData>/pi-sessions`).
   * Each Cowork session then keeps its structured transcript in Pi's own
   * JSONL and rebuilds reopen it instead of replaying a flattened prompt.
   */
  setPiSessionStoreRoot(root: string): void {
    this.piSessionStoreRoot = root;
  }

  /** Drops a session's Pi JSONL so the next turn cannot restore stale history. */
  invalidatePiSessionDir(sessionId: string): void {
    if (!this.piSessionStoreRoot) return;
    invalidatePiSessionDir(this.piSessionStoreRoot, sessionId);
  }

  persistImageAttachments(
    sessionId: string,
    attachments: PiStartOptions['imageAttachments'],
  ): PiStartOptions['imageAttachments'] {
    if (!attachments?.length || !this.imageAttachmentRoot) return attachments;
    // Already on disk — skip a second write when IPC (or enqueue) persisted first.
    if (attachments.every(item => Boolean(item.path) && !item.base64Data)) {
      return attachments;
    }
    return persistCoworkImageAttachments(this.imageAttachmentRoot, sessionId, attachments);
  }

  /**
   * Bundled SKILLs root (resources/SKILLs in production). Injected so the
   * live member source matches the main-session preset snapshot; getSkillsRoot
   * alone is wrong in packaged builds, where it resolves to the userData copy
   * that can drift from the bundled truth.
   */
  setBundledSkillsRoot(root: string): void {
    this.bundledSkillsRoot = root;
  }

  setProjectMemoryService(service: ProjectMemoryService): void {
    this.projectMemoryService = service;
  }

  setSessionSummaryService(service: SessionSummaryService): void {
    this.sessionSummaryService = service;
  }

  setSessionSummaryBackfillService(service: SessionSummaryBackfillService): void {
    this.sessionSummaryBackfillService = service;
  }

  setConversationHistoryService(service: ConversationHistoryService): void {
    this.conversationHistoryService = service;
  }

  setScheduledTaskService(service: ScheduledTaskService): void {
    this.scheduledTaskService = service;
  }

  /** Resolves the delivery scheduled tasks in a session default to (IM chats). */
  protected scheduledTaskDeliveryResolver:
    | ((sessionId: string) => ScheduledTaskDelivery | null)
    | null = null;

  setScheduledTaskDeliveryResolver(
    resolver: (sessionId: string) => ScheduledTaskDelivery | null,
  ): () => void {
    this.scheduledTaskDeliveryResolver = resolver;
    return () => {
      if (this.scheduledTaskDeliveryResolver === resolver)
        this.scheduledTaskDeliveryResolver = null;
    };
  }

  getScheduledTaskDeliveryForSession(sessionId: string): ScheduledTaskDelivery | null {
    return this.scheduledTaskDeliveryResolver?.(sessionId) ?? null;
  }

  setMcpServerManager(mgr: McpServerManager): void {
    this.mcpServerManager = mgr;
    this.mcpInjected = true;
    this.mcpToolManifestGeneration += 1;
  }

  setArtifactLedger(ledger: ArtifactLedger): void {
    this.artifactLedgerService = ledger;
  }

  refreshMcpTools(): void {
    this.mcpToolManifestGeneration += 1;
  }

  hasMcpServerManager(): boolean {
    return this.mcpInjected;
  }

  protected mcpInjected = false;

  getStore(): CoworkStore | null {
    return this.store;
  }

  getArtifactLedger(): ArtifactLedger | null {
    return this.artifactLedgerService;
  }

  getProjectMemoryService(): ProjectMemoryService | null {
    return this.projectMemoryService;
  }

  getConversationHistoryService(): ConversationHistoryService | null {
    return this.conversationHistoryService;
  }

  getScheduledTaskService(): ScheduledTaskService | null {
    return this.scheduledTaskService;
  }

  getMcpServerManager(): McpServerManager | null {
    return this.mcpServerManager;
  }

  getMcpToolManifestGeneration(): number {
    return this.mcpToolManifestGeneration;
  }

  getPiSessionStoreRoot(): string | null {
    return this.piSessionStoreRoot;
  }

  getOcrCommandFor(): ((imagePath: string) => string) | undefined {
    return this.bundledOcrHelper?.commandFor;
  }

  isStoredSessionWorkMode(sessionId: string): boolean {
    return (
      this.store?.getSession(sessionId, 0, { includeArtifacts: false })?.mode !==
      CoworkSessionMode.Chat
    );
  }

  getPiAgentsDir(): string {
    const homedir = os.homedir();
    const configDir = process.env.PI_CODING_AGENT_DIR || path.join(homedir, '.pi', 'agent');
    return path.join(configDir, 'agents');
  }

  /**
   * Live team member definitions for bundled presets. Returns null when the
   * preset is not bundled, so the subagent tool falls back to the synced pi
   * agents files (user-imported packages).
   */
  resolveBundledMemberProfiles(
    presetId: string,
  ): Array<{ id: string; description: string; systemPrompt: string }> | null {
    return resolveBundledPresetMembers(this.bundledSkillsRoot ?? getSkillsRoot(), presetId);
  }
}
