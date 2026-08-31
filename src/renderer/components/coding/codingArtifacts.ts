import { CodingEventKind, type CodingEvent } from '../../../shared/codingAgent';
import {
  extractFilePath,
  getArtifactTypeFromExtension,
  getFileExtension,
  getFileName,
  normalizeFilePathForDedup,
  normalizeToolName,
  WRITE_TOOL_NAMES,
} from '../../services/artifactParser';
import { ArtifactRole, isBinaryArtifactFile, type Artifact } from '../../types/artifact';

/**
 * Coding agents produce deliverables by writing files, not by emitting
 * markdown code blocks — so artifacts are collected from file-change and
 * tool-call events. Source-code types are excluded: edits to .ts/.js/… are
 * already covered by the diff view and the git panel, and listing them as
 * artifacts would flood the panel.
 */
const COLLECTIBLE_TYPES = new Set(['html', 'svg', 'mermaid', 'markdown', 'text', 'image', 'document']);

export interface CodingFileArtifact {
  artifact: Artifact;
  /** True when the content must be read from disk before previewing. */
  needsFileLoad: boolean;
  /** Id of the event that last touched the file; changes signal a rewrite. */
  version: string;
  /** Tool call that produced the file, when known — anchors the preview card. */
  toolCallId: string | null;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const readString = (value: unknown): string | null =>
  typeof value === 'string' && value ? value : null;

/** Resolves an artifact path to an absolute filesystem path for disk reads. */
export const resolveArtifactFilePath = (rawPath: string, baseDir?: string | null): string => {
  let path = rawPath.replace(/^file:\/\/\/?/i, '');
  try {
    path = decodeURIComponent(path);
  } catch {
    // Keep the raw path when it is not URI-encoded.
  }
  if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1);
  if (path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)) return path;
  return baseDir ? `${baseDir}/${path}` : path;
};

const buildArtifact = (
  event: CodingEvent,
  sessionId: string,
  rawPath: string,
  baseDir: string | null | undefined,
  content: string,
  toolCallId: string | null,
): CodingFileArtifact | null => {
  const filePath = resolveArtifactFilePath(rawPath, baseDir);
  const type = getArtifactTypeFromExtension(getFileExtension(filePath));
  if (!type || !COLLECTIBLE_TYPES.has(type)) return null;
  const fileName = getFileName(filePath);
  return {
    artifact: {
      id: `coding-file-${normalizeFilePathForDedup(filePath)}`,
      // File-backed artifacts are not anchored to a message; they surface in
      // the artifact panel and next to the producing tool call.
      messageId: '',
      sessionId,
      type,
      title: fileName,
      content,
      fileName,
      filePath,
      source: 'tool',
      role: ArtifactRole.Deliverable,
      declared: false,
      createdAt: event.createdAt,
    },
    needsFileLoad: content === '',
    version: event.id,
    toolCallId,
  };
};

const artifactFromFileChange = (
  event: CodingEvent,
  sessionId: string,
  baseDir: string | null | undefined,
): CodingFileArtifact | null => {
  const payload = event.payload;
  const filePath = readString(payload.path);
  if (!filePath) return null;
  const toolCallId = readString(payload.toolCallId);
  if (payload.type === 'diff') {
    const newText = readString(payload.newText);
    const content = newText !== null && !isBinaryArtifactFile(filePath) ? newText : '';
    return buildArtifact(event, sessionId, filePath, baseDir, content, toolCallId);
  }
  if (payload.action === 'write') {
    return buildArtifact(event, sessionId, filePath, baseDir, '', toolCallId);
  }
  return null;
};

const artifactFromToolCall = (
  event: CodingEvent,
  sessionId: string,
  baseDir: string | null | undefined,
): CodingFileArtifact | null => {
  const payload = event.payload;
  const toolName = readString(payload.toolName) ?? readString(payload.title);
  const input = asRecord(payload.toolInput) ?? asRecord(payload.rawInput);
  if (!input) return null;
  const isWriteTool = toolName !== null && WRITE_TOOL_NAMES.has(normalizeToolName(toolName));
  const filePath = extractFilePath(input);
  if (!filePath) return null;
  const content = readString(input.content);
  // A write-shaped input (path + content) is accepted even when the tool name
  // is unknown; without content only known write tools qualify.
  if (!isWriteTool && content === null) return null;
  return buildArtifact(
    event,
    sessionId,
    filePath,
    baseDir,
    content ?? '',
    readString(payload.toolCallId),
  );
};

/**
 * Collects file-backed artifacts from a lane's event stream. Several events
 * may touch the same file through different shapes (a relative tool input and
 * an absolute broker write); they merge into one artifact that keeps any
 * inline content, the producing tool call, and the latest write version.
 */
export const collectCodingFileArtifacts = (
  events: CodingEvent[],
  sessionId: string,
  baseDir?: string | null,
): CodingFileArtifact[] => {
  const byPath = new Map<string, CodingFileArtifact>();
  for (const event of events) {
    const candidate =
      event.kind === CodingEventKind.FileChange
        ? artifactFromFileChange(event, sessionId, baseDir)
        : event.kind === CodingEventKind.ToolCall
          ? artifactFromToolCall(event, sessionId, baseDir)
          : null;
    if (!candidate?.artifact.filePath) continue;
    const key = normalizeFilePathForDedup(candidate.artifact.filePath);
    const existing = byPath.get(key);
    if (!existing) {
      byPath.set(key, candidate);
      continue;
    }
    const content = candidate.artifact.content || existing.artifact.content;
    byPath.set(key, {
      artifact: {
        ...candidate.artifact,
        content,
        createdAt: existing.artifact.createdAt,
      },
      // A later broker write without inline content still means the file on
      // disk changed, so refresh it even when older inline content exists.
      needsFileLoad: candidate.needsFileLoad && content === '',
      version: candidate.version,
      toolCallId: candidate.toolCallId ?? existing.toolCallId,
    });
  }
  return [...byPath.values()];
};
