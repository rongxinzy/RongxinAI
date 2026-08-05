import { discoverWorkbenchMessageArtifactBlocks } from '../shared/workbenchTask';
import type { CoworkArtifactType, CoworkPersistedArtifact } from '../shared/cowork/artifacts';
import { CoworkArtifactRole, CoworkArtifactSource } from '../shared/cowork/artifacts';

const DECLARE_ARTIFACT_TOOL = 'declare_artifact';
const WRITE_TOOL_NAMES = new Set(['write', 'writefile']);

const LANGUAGE_TYPES: Record<string, CoworkArtifactType> = {
  html: 'html',
  svg: 'svg',
  mermaid: 'mermaid',
  jsx: 'code',
  tsx: 'code',
  markdown: 'markdown',
  md: 'markdown',
  text: 'text',
  txt: 'text',
  plaintext: 'text',
};

const EXTENSION_TYPES: Record<string, CoworkArtifactType> = {
  '.html': 'html',
  '.htm': 'html',
  '.svg': 'svg',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.gif': 'image',
  '.webp': 'image',
  '.mermaid': 'mermaid',
  '.mmd': 'mermaid',
  '.jsx': 'code',
  '.tsx': 'code',
  '.js': 'code',
  '.mjs': 'code',
  '.cjs': 'code',
  '.ts': 'code',
  '.mts': 'code',
  '.cts': 'code',
  '.css': 'code',
  '.scss': 'code',
  '.less': 'code',
  '.json': 'code',
  '.yaml': 'code',
  '.yml': 'code',
  '.xml': 'code',
  '.py': 'code',
  '.java': 'code',
  '.go': 'code',
  '.rs': 'code',
  '.md': 'markdown',
  '.txt': 'text',
  '.log': 'text',
  '.csv': 'document',
  '.tsv': 'document',
  '.xls': 'document',
  '.docx': 'document',
  '.xlsx': 'document',
  '.pptx': 'document',
  '.pdf': 'document',
};

export interface CoworkArtifactMessage {
  id: string;
  type: string;
  content: string;
  timestamp: number;
  sequence: number;
  metadata?: Record<string, unknown>;
}

export interface CoworkArtifactCandidate {
  artifactKey: string;
  artifact: CoworkPersistedArtifact;
}

export function normalizeArtifactPath(filePath: string): string {
  const withoutFileUrlPrefix = filePath.replace(/^file:\/\/+/, '');
  const withoutWindowsUrlSlash = /^\/[A-Za-z]:/.test(withoutFileUrlPrefix)
    ? withoutFileUrlPrefix.slice(1)
    : withoutFileUrlPrefix;
  return withoutWindowsUrlSlash.replace(/\\/g, '/').toLowerCase();
}

function normalizeToolName(name: string): string {
  return name.toLowerCase().replace(/[_\s]/g, '');
}

function getFileName(filePath: string): string {
  const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return lastSlash === -1 ? filePath : filePath.slice(lastSlash + 1);
}

function getFileExtension(filePath: string): string {
  const lastDot = filePath.lastIndexOf('.');
  return lastDot === -1 ? '' : filePath.slice(lastDot).toLowerCase();
}

function resolveArtifactType(filePath: string, declaredKind?: string): CoworkArtifactType | null {
  if (declaredKind) {
    const declaredType = LANGUAGE_TYPES[declaredKind.toLowerCase()];
    if (declaredType) return declaredType;
  }
  return EXTENSION_TYPES[getFileExtension(filePath)] ?? null;
}

function extractWriteToolPath(input: Record<string, unknown>): string | null {
  for (const key of ['file_path', 'path', 'filePath', 'target_file', 'targetFile']) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function collectDeclarations(messages: CoworkArtifactMessage[]): CoworkArtifactCandidate[] {
  const candidates: CoworkArtifactCandidate[] = [];
  for (const message of messages) {
    if (message.type !== 'tool_use' || message.metadata?.toolName !== DECLARE_ARTIFACT_TOOL) {
      continue;
    }
    const input = (message.metadata.toolInput ?? {}) as Record<string, unknown>;
    const filePath = typeof input.filePath === 'string' ? input.filePath.trim() : '';
    if (!filePath) continue;

    const kind = typeof input.kind === 'string' ? input.kind.trim() : undefined;
    const fileName = getFileName(filePath);
    candidates.push({
      artifactKey: `path:${normalizeArtifactPath(filePath)}`,
      artifact: {
        id: `artifact-declare-${message.id}`,
        messageId: message.id,
        type: resolveArtifactType(filePath, kind) ?? 'code',
        title:
          typeof input.title === 'string' && input.title.trim() ? input.title.trim() : fileName,
        content: '',
        fileName,
        filePath,
        source: CoworkArtifactSource.Tool,
        role:
          input.role === CoworkArtifactRole.Intermediate
            ? CoworkArtifactRole.Intermediate
            : CoworkArtifactRole.Deliverable,
        declared: true,
        createdAt: message.timestamp,
      },
    });
  }
  return candidates;
}

function collectWrites(messages: CoworkArtifactMessage[]): CoworkArtifactCandidate[] {
  const candidates: CoworkArtifactCandidate[] = [];
  const failedToolUseIds = new Set(
    messages
      .filter(message => message.type === 'tool_result' && message.metadata?.isError)
      .map(message => message.metadata?.toolUseId)
      .filter((toolUseId): toolUseId is string => typeof toolUseId === 'string'),
  );
  for (const message of messages) {
    if (message.type !== 'tool_use') continue;
    const toolName = message.metadata?.toolName;
    if (typeof toolName !== 'string' || !WRITE_TOOL_NAMES.has(normalizeToolName(toolName))) {
      continue;
    }
    const toolUseId = message.metadata?.toolUseId;
    if (typeof toolUseId === 'string' && failedToolUseIds.has(toolUseId)) continue;
    const input = (message.metadata?.toolInput ?? {}) as Record<string, unknown>;
    const filePath = extractWriteToolPath(input);
    if (!filePath) continue;
    const type = resolveArtifactType(filePath);
    if (!type) continue;
    const fileName = getFileName(filePath);
    candidates.push({
      artifactKey: `path:${normalizeArtifactPath(filePath)}`,
      artifact: {
        id: `artifact-tool-${message.id}`,
        messageId: message.id,
        type,
        title: fileName,
        content: '',
        fileName,
        filePath,
        source: CoworkArtifactSource.Tool,
        role: CoworkArtifactRole.Deliverable,
        declared: false,
        createdAt: message.timestamp,
      },
    });
  }
  return candidates;
}

function collectCodeBlocks(messages: CoworkArtifactMessage[]): CoworkArtifactCandidate[] {
  const candidates: CoworkArtifactCandidate[] = [];
  for (const message of messages) {
    if (message.type !== 'assistant' || !message.content || message.metadata?.isThinking) {
      continue;
    }
    for (const block of discoverWorkbenchMessageArtifactBlocks(message.content)) {
      const type = LANGUAGE_TYPES[block.language];
      if (!type && !block.explicit) continue;
      const artifactType = type ?? 'code';
      candidates.push({
        artifactKey: `message:${message.id}:block:${block.index}`,
        artifact: {
          id: `artifact-${message.id}-${block.index}`,
          messageId: message.id,
          type: artifactType,
          title: block.title || `${block.language || artifactType} code`,
          content: block.content,
          language: artifactType === 'code' ? block.language : undefined,
          source: CoworkArtifactSource.CodeBlock,
          role: CoworkArtifactRole.Deliverable,
          declared: false,
          createdAt: message.timestamp,
        },
      });
    }
  }
  return candidates;
}

/**
 * Collect declarations first so their metadata is authoritative regardless of
 * whether a write call appears before or after declare_artifact in the stream.
 */
export function collectSessionArtifactCandidates(
  messages: CoworkArtifactMessage[],
): CoworkArtifactCandidate[] {
  const declarations = collectDeclarations(messages);
  return [...declarations, ...collectWrites(messages), ...collectCodeBlocks(messages)];
}
