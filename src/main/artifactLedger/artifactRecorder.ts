/**
 * ArtifactRecorder: event-time artifact capture for one active Pi session.
 *
 * Driven from the Pi event projection (tool start/end, run start/settled):
 * - write/edit tools record their target file on success;
 * - other tools schedule a debounced workspace-diff rescan;
 * - run settle runs a final diff anchored to the final answer message.
 */
import { stat } from 'fs/promises';

import {
  extractFilePath,
  normalizeToolName,
  WRITE_TOOL_NAMES,
} from '../../shared/cowork/artifactToolShapes';
import {
  getArtifactTypeByExtension,
  isBinaryArtifactFile,
} from '../../shared/cowork/artifactPreview';
import type { CoworkArtifactRole, CoworkArtifactType } from '../../shared/cowork/artifacts';
import { CoworkArtifactRole as ArtifactRole } from '../../shared/cowork/artifacts';
import {
  artifactKeyForPath,
  ArtifactLedger,
  getArtifactFileName,
  resolveArtifactInputPath,
} from './artifactLedger';
import { publishArtifactUpsert } from './publisher';
import { isInternalWorkflowStatePath } from './summaryWork';
import {
  takeWorkspaceSnapshot,
  type WorkspaceSnapshot,
  type WorkspaceSnapshotOptions,
} from './workspaceSnapshot';

const EDIT_TOOL_NAME = normalizeToolName('edit');
/** Debounce for the post-tool workspace rescan; trades latency for fewer walks. */
const DIFF_DEBOUNCE_MS = 400;

function isWriteOrEditToolName(normalizedName: string): boolean {
  return WRITE_TOOL_NAMES.has(normalizedName) || normalizedName === EDIT_TOOL_NAME;
}
export interface ArtifactRecorderOptions {
  sessionId: string;
  workspaceRoot: string;
  ledger: ArtifactLedger;
  /** Snapshot overrides (tests); production uses the default caps. */
  snapshotOptions?: WorkspaceSnapshotOptions;
}

interface ToolStartInfo {
  toolName: string;
  args: Record<string, unknown>;
}

export interface RecorderToolEndInput {
  toolCallId: string;
  toolName?: string;
  args?: unknown;
  result?: unknown;
  isError: boolean;
  resultMessageId: string;
}

export class ArtifactRecorder {
  private readonly sessionId: string;
  private readonly workspaceRoot: string;
  private readonly ledger: ArtifactLedger;
  private readonly snapshotOptions: WorkspaceSnapshotOptions | undefined;
  private readonly lifecycle = new AbortController();
  private readonly toolStartInfo = new Map<string, ToolStartInfo>();

  private runId: string | null = null;
  private recordedKeys = new Set<string>();
  private readonly recordedMtimes = new Map<string, number>();
  private readonly pendingMtimeReads = new Set<Promise<void>>();
  private workVersion = 0;
  private baseline: WorkspaceSnapshot | null = null;
  private latest: WorkspaceSnapshot | null = null;
  private baselinePromise: Promise<WorkspaceSnapshot | null> | null = null;
  private diffTimer: ReturnType<typeof setTimeout> | null = null;
  private lastDiff: Promise<void> | null = null;
  private diffAnchor = '';
  private warnedTruncated = false;
  private runGeneration = 0;
  private disposed = false;

  constructor(options: ArtifactRecorderOptions) {
    this.sessionId = options.sessionId;
    this.workspaceRoot = options.workspaceRoot;
    this.ledger = options.ledger;
    this.snapshotOptions = options.snapshotOptions;
  }

  /** New agent run: reset per-run state and capture the workspace baseline. */
  onRunStart(runId: string | null): void {
    if (this.disposed) return;
    this.runId = runId;
    this.runGeneration += 1;
    this.recordedKeys = new Set();
    this.recordedMtimes.clear();
    this.workVersion = 0;
    this.baseline = null;
    this.latest = null;
    const generation = this.runGeneration;
    this.baselinePromise = takeWorkspaceSnapshot(this.workspaceRoot, {
      ...this.snapshotOptions,
      signal: this.lifecycle.signal,
    }).then(snapshot => {
      if (this.disposed || generation !== this.runGeneration || !snapshot) return snapshot;
      this.baseline = snapshot;
      this.latest = snapshot;
      this.warnOnceIfTruncated(snapshot);
      return snapshot;
    });
  }

  /** Tool execution begins: cache tool inputs so tool_execution_end has full context. */
  onToolStart(toolCallId: string, toolName: string, args: unknown): void {
    if (this.disposed) return;
    const input = asToolInput(args);
    this.toolStartInfo.set(toolCallId, { toolName, args: input });
  }

  /** Tool execution ends: record write/edit outputs or schedule a diff. */
  onToolEnd(input: RecorderToolEndInput): void {
    if (this.disposed) return;
    const startInfo = this.toolStartInfo.get(input.toolCallId);
    this.toolStartInfo.delete(input.toolCallId);
    const toolName = input.toolName ?? startInfo?.toolName ?? '';
    const normalized = normalizeToolName(toolName);
    const args = asToolInput(input.args ?? startInfo?.args);

    const rawPath = extractFilePath(args);
    if (rawPath && isWriteOrEditToolName(normalized)) {
      const absolutePath = resolveArtifactInputPath(rawPath, this.workspaceRoot);
      if (input.isError) return;
      // Anchored to the persisted tool_result message, like the diff path.
      this.recordWrite({
        absolutePath,
        toolCallId: input.toolCallId,
        messageId: input.resultMessageId,
        content:
          typeof args.content === 'string' && !isBinaryArtifactFile(absolutePath)
            ? args.content
            : '',
      });
      return;
    }

    // Any other tool may still have produced files (bash, python, skills).
    this.scheduleDiff(input.resultMessageId);
  }

  /** Run settled: flush the final workspace diff anchored to the final answer. */
  onRunSettled(finalAnswerMessageId: string | null): void {
    if (this.disposed) return;
    if (this.diffTimer) {
      clearTimeout(this.diffTimer);
      this.diffTimer = null;
    }
    const anchor = finalAnswerMessageId ?? this.diffAnchor;
    this.lastDiff = this.runDiff(anchor, true);
  }

  /** Resolves once the settle-time workspace diff has landed in the ledger;
   * task delivery reads the run's rows only after this. Never rejects. */
  async settled(): Promise<void> {
    try {
      await this.lastDiff;
    } catch {
      // A failed diff leaves the rows recorded so far; delivery still proceeds.
    }
  }

  /**
   * Deterministic flush for tests: waits for the run-start baseline, runs a
   * debounce-pending diff immediately, and awaits any in-flight diff. Never
   * relies on the real debounce timer firing.
   */
  async flushDiffs(): Promise<void> {
    await this.baselinePromise;
    if (this.diffTimer) {
      clearTimeout(this.diffTimer);
      this.diffTimer = null;
      this.lastDiff = this.runDiff(this.diffAnchor, false);
    }
    await this.lastDiff;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.lifecycle.abort();
    if (this.diffTimer) {
      clearTimeout(this.diffTimer);
      this.diffTimer = null;
    }
    this.toolStartInfo.clear();
  }

  private recordWrite(input: {
    absolutePath: string;
    toolCallId: string;
    messageId: string;
    content: string;
  }): void {
    const type = getArtifactTypeByExtension(input.absolutePath);
    if (!type) return;
    this.record({
      filePath: input.absolutePath,
      id: `artifact-tool-${input.messageId}`,
      messageId: input.messageId,
      toolCallId: input.toolCallId,
      runId: this.runId,
      type,
      title: getArtifactFileName(input.absolutePath),
      content: input.content,
      source: 'tool',
      role: ArtifactRole.Intermediate,
      declared: false,
    });
    this.rememberRecordedMtime(input.absolutePath);
  }

  hasRecordedFiles(): boolean {
    return this.workVersion > 0;
  }

  recordedWorkVersion(): number {
    return this.workVersion;
  }

  private record(input: {
    filePath: string;
    id: string;
    messageId: string;
    toolCallId: string | null;
    runId: string | null;
    type: CoworkArtifactType;
    title: string;
    content: string;
    source: 'tool';
    role: CoworkArtifactRole;
    declared: boolean;
  }): void {
    try {
      const artifact = this.ledger.recordFile(this.sessionId, {
        filePath: input.filePath,
        id: input.id,
        messageId: input.messageId,
        toolCallId: input.toolCallId,
        runId: input.runId,
        type: input.type,
        title: input.title,
        content: input.content,
        source: input.source,
        role: input.role,
        declared: input.declared,
        createdAt: Date.now(),
      });
      if (artifact) {
        if (!isInternalWorkflowStatePath(input.filePath, this.workspaceRoot)) this.workVersion += 1;
        this.recordedKeys.add(artifactKeyForPath(input.filePath));
        publishArtifactUpsert(this.sessionId, artifact);
      }
    } catch (error) {
      console.warn(
        `[ArtifactRecorder] failed to record artifact for session ${this.sessionId}:`,
        error,
      );
    }
  }

  private rememberRecordedMtime(filePath: string): void {
    const key = artifactKeyForPath(filePath);
    const generation = this.runGeneration;
    const pending = stat(filePath)
      .then(info => {
        if (!this.disposed && generation === this.runGeneration) {
          this.recordedMtimes.set(key, info.mtimeMs);
        }
      })
      .catch((): void => {})
      .finally(() => {
        this.pendingMtimeReads.delete(pending);
      });
    this.pendingMtimeReads.add(pending);
  }

  private scheduleDiff(anchorMessageId: string): void {
    if (this.diffTimer) clearTimeout(this.diffTimer);
    this.diffAnchor = anchorMessageId;
    this.diffTimer = setTimeout(() => {
      this.diffTimer = null;
      this.lastDiff = this.runDiff(anchorMessageId, false);
    }, DIFF_DEBOUNCE_MS);
  }

  private async runDiff(anchorMessageId: string, isFinal: boolean): Promise<void> {
    if (this.disposed) return;
    // A diff that outlives its run must not stamp the next run with stale
    // baselines or attribute records to the wrong run.
    const generation = this.runGeneration;
    const base = this.latest ?? (await this.baselinePromise);
    if (this.disposed || generation !== this.runGeneration || !base) return;
    const next = await takeWorkspaceSnapshot(this.workspaceRoot, {
      ...this.snapshotOptions,
      signal: this.lifecycle.signal,
    });
    if (this.disposed || generation !== this.runGeneration || !next) return;
    if (base.truncated || next.truncated) {
      this.warnOnceIfTruncated(next.truncated ? next : base);
      return;
    }
    await Promise.all([...this.pendingMtimeReads]);
    if (this.disposed || generation !== this.runGeneration) return;
    for (const [key, entry] of next.byKey) {
      if (base.byKey.get(key)?.mtimeMs === entry.mtimeMs) continue;
      const artifactKey = artifactKeyForPath(entry.path);
      if (this.recordedKeys.has(artifactKey)) {
        if (
          this.recordedMtimes.get(artifactKey) !== entry.mtimeMs &&
          !isInternalWorkflowStatePath(entry.path, this.workspaceRoot)
        ) {
          this.workVersion += 1;
        }
        this.recordedMtimes.set(artifactKey, entry.mtimeMs);
        continue;
      }
      const type = getArtifactTypeByExtension(entry.path);
      if (!type) continue;
      this.record({
        filePath: entry.path,
        id: `artifact-diff-${anchorMessageId}-${key}`,
        messageId: anchorMessageId,
        toolCallId: null,
        runId: this.runId,
        type,
        title: getArtifactFileName(entry.path),
        content: '',
        source: 'tool',
        role: ArtifactRole.Intermediate,
        declared: false,
      });
      this.recordedMtimes.set(artifactKey, entry.mtimeMs);
    }
    this.latest = next;
    if (isFinal) this.diffAnchor = '';
  }

  private warnOnceIfTruncated(snapshot: WorkspaceSnapshot): void {
    if (!snapshot.truncated || this.warnedTruncated) return;
    this.warnedTruncated = true;
    console.warn(
      `[ArtifactRecorder] workspace snapshot truncated for session ${this.sessionId}; skipping diff-based artifact detection`,
    );
  }
}

function asToolInput(args: unknown): Record<string, unknown> {
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    return args as Record<string, unknown>;
  }
  return {};
}
