/**
 * External coding lanes record artifacts from their events. Built-in lanes
 * read artifacts from their Pi session.
 */
import type Database from 'better-sqlite3';

import { CodingAgentProfileId, CodingEventKind } from '../../shared/codingAgent';
import {
  CoworkArtifactRole,
  type CoworkArtifactType,
  type CoworkPersistedArtifact,
} from '../../shared/cowork/artifacts';
import {
  extractFilePath,
  normalizeToolName,
  WRITE_TOOL_NAMES,
} from '../../shared/cowork/artifactToolShapes';
import {
  getArtifactTypeByExtension,
  isBinaryArtifactFile,
} from '../../shared/cowork/artifactPreview';
import {
  type ArtifactLedger,
  artifactKeyForPath,
  getArtifactFileName,
  resolveArtifactInputPath,
} from './artifactLedger';
import { publishArtifactUpsert } from './publisher';

/** Source-code types are excluded from coding artifacts: the diff view and
 * git panel already own them, and listing them floods the panel. */
const CODING_COLLECTIBLE_TYPES = new Set([
  'html',
  'svg',
  'mermaid',
  'markdown',
  'text',
  'image',
  'document',
  'model',
  'unsupported',
]);

export function isCodingLaneArtifact(artifact: CoworkPersistedArtifact): boolean {
  return Boolean(artifact.filePath) && CODING_COLLECTIBLE_TYPES.has(artifact.type);
}

const readString = (value: unknown): string | null =>
  typeof value === 'string' && value ? value : null;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/**
 * Record file-backed artifacts for a coding event. Never throws into the
 * event-append path; failures are logged and skipped.
 */
export function recordCodingLaneArtifact(
  db: Database.Database,
  ledger: ArtifactLedger,
  laneId: string,
  kind: CodingEventKind,
  payload: Record<string, unknown>,
): void {
  if (kind !== CodingEventKind.FileChange && kind !== CodingEventKind.ToolCall) return;
  try {
    const lane = db
      .prepare(
        'SELECT profile_id, execution_root, source_root FROM coding_agent_lanes WHERE id = ?',
      )
      .get(laneId) as
      | { profile_id: string; execution_root: string; source_root: string }
      | undefined;
    if (!lane || lane.profile_id === CodingAgentProfileId.Builtin) return;
    const baseDir = readString(lane?.execution_root) ?? readString(lane?.source_root);
    if (!baseDir) return;
    const candidate = extractCandidate(kind, payload, baseDir);
    if (!candidate) return;
    const artifact = ledger.recordFile(laneId, {
      filePath: candidate.filePath,
      id: `coding-file-${artifactKeyForPath(candidate.filePath)}`,
      messageId: '',
      toolCallId: candidate.toolCallId,
      runId: laneWorkbenchRunId(db, laneId),
      type: candidate.type,
      title: getArtifactFileName(candidate.filePath),
      content: candidate.content,
      source: 'tool',
      role: CoworkArtifactRole.Deliverable,
      declared: false,
      createdAt: Date.now(),
    });
    if (artifact) publishArtifactUpsert(laneId, artifact);
  } catch (error) {
    console.warn(`[ArtifactLedger] failed to record coding lane artifact for ${laneId}:`, error);
  }
}

/**
 * External coding turns run inside a workbench run linked through the lane's
 * latest assignment; task delivery reads the run's ledger rows by it.
 */
function laneWorkbenchRunId(db: Database.Database, laneId: string): string | null {
  try {
    const row = db
      .prepare(
        'SELECT workbench_run_id FROM coding_assignments WHERE lane_id = ? ORDER BY created_at DESC LIMIT 1',
      )
      .get(laneId) as { workbench_run_id?: unknown } | undefined;
    return readString(row?.workbench_run_id);
  } catch {
    // Lanes without assignments (or stores without the table) record no run.
    return null;
  }
}

interface CandidateInput {
  filePath: string;
  type: CoworkArtifactType;
  content: string;
  toolCallId: string | null;
}

function extractCandidate(
  kind: CodingEventKind,
  payload: Record<string, unknown>,
  baseDir: string,
): CandidateInput | null {
  if (kind === CodingEventKind.FileChange) {
    const rawPath = readString(payload.path);
    if (!rawPath) return null;
    const toolCallId = readString(payload.toolCallId);
    if (payload.type === 'diff') {
      const resolved = resolveArtifactInputPath(rawPath, baseDir);
      const newText = readString(payload.newText);
      return finishCandidate(
        resolved,
        newText !== null && !isBinaryArtifactFile(resolved) ? newText : '',
        toolCallId,
      );
    }
    if (payload.action === 'write') {
      return finishCandidate(resolveArtifactInputPath(rawPath, baseDir), '', toolCallId);
    }
    return null;
  }
  if (kind === CodingEventKind.ToolCall) {
    const toolName = readString(payload.toolName) ?? readString(payload.title);
    const input = asRecord(payload.toolInput) ?? asRecord(payload.rawInput);
    if (!input) return null;
    const isWriteTool = toolName !== null && WRITE_TOOL_NAMES.has(normalizeToolName(toolName));
    const rawPath = extractFilePath(input);
    if (!rawPath) return null;
    const content = readString(input.content);
    // A write-shaped input (path + content) is accepted even when the tool
    // name is unknown; without content only known write tools qualify.
    if (!isWriteTool && content === null) return null;
    return finishCandidate(
      resolveArtifactInputPath(rawPath, baseDir),
      content ?? '',
      readString(payload.toolCallId),
    );
  }
  return null;
}

function finishCandidate(
  filePath: string,
  content: string,
  toolCallId: string | null,
): CandidateInput | null {
  const type = getArtifactTypeByExtension(filePath);
  if (!type || !CODING_COLLECTIBLE_TYPES.has(type)) return null;
  return { filePath, type, content, toolCallId };
}
