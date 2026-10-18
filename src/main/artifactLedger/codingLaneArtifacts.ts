/**
 * Coding-lane artifact recording at the event-write choke point.
 *
 * CodingRoomRepository.appendEvent delegates here after a coding event row is
 * committed. This is the only coding-artifact rule: FileChange events with a
 * diff/write action and write-shaped ToolCall events become ledger rows scoped
 * to the lane id, resolved against the lane's execution root.
 */
import type Database from 'better-sqlite3';

import { CodingEventKind } from '../../shared/codingAgent';
import { CoworkArtifactRole, type CoworkArtifactType } from '../../shared/cowork/artifacts';
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
  ArtifactLedger,
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

const readString = (value: unknown): string | null =>
  typeof value === 'string' && value ? value : null;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const ledgers = new WeakMap<Database.Database, ArtifactLedger>();

function ledgerFor(db: Database.Database): ArtifactLedger {
  let ledger = ledgers.get(db);
  if (!ledger) {
    ledger = new ArtifactLedger(db);
    ledgers.set(db, ledger);
  }
  return ledger;
}

/**
 * Record file-backed artifacts for a coding event. Never throws into the
 * event-append path; failures are logged and skipped.
 */
export function recordCodingLaneArtifact(
  db: Database.Database,
  laneId: string,
  kind: CodingEventKind,
  payload: Record<string, unknown>,
): void {
  try {
    const lane = db
      .prepare('SELECT execution_root, source_root FROM coding_agent_lanes WHERE id = ?')
      .get(laneId) as { execution_root?: string | null; source_root?: string | null } | undefined;
    const baseDir = readString(lane?.execution_root) ?? readString(lane?.source_root);
    if (!baseDir) return;
    const candidate = extractCandidate(kind, payload, baseDir);
    if (!candidate) return;
    const artifact = ledgerFor(db).recordFile(laneId, {
      filePath: candidate.filePath,
      id: `coding-file-${artifactKeyForPath(candidate.filePath)}`,
      messageId: '',
      toolCallId: candidate.toolCallId,
      runId: null,
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
