import { ArtifactRole, type Artifact, type ArtifactType } from '../types/artifact';
import type { CoworkMessage } from '../types/cowork';
import { discoverWorkbenchMessageArtifactBlocks } from '../../shared/workbenchTask';

/**
 * Normalize file path for deduplication comparison.
 * Handles Windows file:// URL leading slash and backslash differences.
 */
export function normalizeFilePathForDedup(p: string): string {
  // Strip leading / before drive letter (e.g. /D:/path from file:///D:/path)
  if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
  // Unify separators and case for comparison
  return p.replace(/\\/g, '/').toLowerCase();
}

const LANGUAGE_TO_ARTIFACT_TYPE: Record<string, ArtifactType> = {
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

const EXTENSION_TO_ARTIFACT_TYPE: Record<string, ArtifactType> = {
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

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const BINARY_DOCUMENT_EXTENSIONS = new Set(['.docx', '.xlsx', '.pptx', '.pdf']);

export function getArtifactTypeFromLanguage(lang: string): ArtifactType | null {
  return LANGUAGE_TO_ARTIFACT_TYPE[lang.toLowerCase()] ?? null;
}

export function getArtifactTypeFromExtension(ext: string): ArtifactType | null {
  return EXTENSION_TO_ARTIFACT_TYPE[ext.toLowerCase()] ?? null;
}

export function isImageExtension(ext: string): boolean {
  return IMAGE_EXTENSIONS.has(ext.toLowerCase());
}

export function isBinaryDocumentExtension(ext: string): boolean {
  return BINARY_DOCUMENT_EXTENSIONS.has(ext.toLowerCase());
}

export function parseCodeBlockArtifacts(
  messageContent: string,
  messageId: string,
  sessionId: string,
): Artifact[] {
  if (!messageContent) return [];

  const artifacts: Artifact[] = [];
  let index = 0;

  for (const block of discoverWorkbenchMessageArtifactBlocks(messageContent)) {
    const isExplicitArtifact = block.explicit;
    const language = block.language;
    const explicitTitle = block.title;
    const content = block.content;

    const artifactType = getArtifactTypeFromLanguage(language);

    if (!artifactType && !isExplicitArtifact) {
      continue;
    }

    const type = artifactType ?? 'code';
    const title = explicitTitle || generateTitle(type, language, content);

    artifacts.push({
      id: `artifact-${messageId}-${index}`,
      messageId,
      sessionId,
      type,
      title,
      content,
      language: type === 'code' ? language : undefined,
      source: 'codeblock',
      role: ArtifactRole.Deliverable,
      createdAt: Date.now(),
    });

    index++;
  }

  return artifacts;
}

const FILE_LINK_RE = /\[([^\]]+)\]\(file:\/\/([^)]+)\)/g;

export function stripFileLinksFromText(text: string): string {
  return text.replace(/\[([^\]]+)\]\(file:\/\/([^)]+)\)/g, '');
}

const BARE_FILE_PATH_RE =
  /(?:^|[\s"'`(])(\/?(?:[^\s"'`()\[\]]+\/)*[^\s"'`()\[\]]+\.(?:html?|svg|png|jpe?g|gif|webp|mermaid|mmd|jsx|tsx|js|mjs|cjs|ts|mts|cts|css|scss|less|json|yaml|yml|xml|py|java|go|rs|docx|xlsx|pptx|pdf|md|txt|log|csv|tsv|xls))(?:[\s"'`)]|$)/gm;

export function parseFilePathsFromText(
  messageContent: string,
  messageId: string,
  sessionId: string,
  idPrefix = 'artifact-path',
  role: Artifact['role'] = ArtifactRole.Deliverable,
): Artifact[] {
  if (!messageContent) return [];

  const artifacts: Artifact[] = [];
  const re = new RegExp(BARE_FILE_PATH_RE.source, 'gm');
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = re.exec(messageContent)) !== null) {
    let filePath = match[1];

    if (filePath.startsWith('file:///')) {
      filePath = filePath.slice(7);
    } else if (filePath.startsWith('file://')) {
      filePath = filePath.slice(7);
    } else if (filePath.startsWith('file:/')) {
      filePath = filePath.slice(5);
    }

    // Strip leading / before Windows drive letter (e.g. /D:/path from file:///D:/path)
    if (/^\/[A-Za-z]:/.test(filePath)) {
      filePath = filePath.slice(1);
    }

    const ext = getFileExtension(filePath);
    const artifactType = getArtifactTypeFromExtension(ext);
    if (!artifactType) continue;

    const fileName = getFileName(filePath);

    artifacts.push({
      id: `${idPrefix}-${messageId}-${index}`,
      messageId,
      sessionId,
      type: artifactType,
      title: fileName,
      content: '',
      fileName,
      filePath,
      source: 'tool',
      role,
      createdAt: Date.now(),
    });

    index++;
  }

  return artifacts;
}

export function parseFileLinksFromMessage(
  messageContent: string,
  messageId: string,
  sessionId: string,
  role: Artifact['role'] = ArtifactRole.Deliverable,
): Artifact[] {
  if (!messageContent) return [];

  const artifacts: Artifact[] = [];
  const re = new RegExp(FILE_LINK_RE.source, 'g');
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = re.exec(messageContent)) !== null) {
    const linkText = match[1];
    let filePath: string;
    try {
      filePath = decodeURIComponent(match[2]);
    } catch {
      filePath = match[2];
    }
    // Strip leading / before Windows drive letter (e.g. /D:/path from file:///D:/path)
    if (/^\/[A-Za-z]:/.test(filePath)) {
      filePath = filePath.slice(1);
    }
    const ext = getFileExtension(filePath);
    const artifactType = getArtifactTypeFromExtension(ext);
    if (!artifactType) continue;

    const fileName = getFileName(filePath);

    artifacts.push({
      id: `artifact-link-${messageId}-${index}`,
      messageId,
      sessionId,
      type: artifactType,
      title: linkText || fileName,
      content: '',
      fileName,
      filePath,
      source: 'tool',
      role,
      createdAt: Date.now(),
    });

    index++;
  }

  return artifacts;
}

function generateTitle(type: ArtifactType, language: string, content: string): string {
  switch (type) {
    case 'html': {
      const titleMatch = content.match(/<title>([^<]+)<\/title>/i);
      return titleMatch ? titleMatch[1] : 'HTML Page';
    }
    case 'svg':
      return 'SVG Image';
    case 'mermaid':
      return 'Mermaid Diagram';
    case 'image':
      return 'Image';
    case 'markdown':
      return 'Markdown Document';
    case 'text':
      return 'Text File';
    case 'document':
      return 'Document';
    case 'code':
      return `${language.charAt(0).toUpperCase() + language.slice(1)} Code`;
  }
}

const WRITE_TOOL_NAMES = new Set(['write', 'writefile', 'write_file']);

function normalizeToolName(name: string): string {
  return name.toLowerCase().replace(/[_\s]/g, '');
}

function extractFilePath(toolInput: Record<string, unknown>): string | null {
  for (const key of ['file_path', 'path', 'filePath', 'target_file', 'targetFile']) {
    const val = toolInput[key];
    if (typeof val === 'string' && val.length > 0) {
      return val;
    }
  }
  return null;
}

function getFileExtension(filePath: string): string {
  const lastDot = filePath.lastIndexOf('.');
  if (lastDot === -1) return '';
  return filePath.slice(lastDot).toLowerCase();
}

function getFileName(filePath: string): string {
  const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return lastSlash === -1 ? filePath : filePath.slice(lastSlash + 1);
}

export function parseToolArtifact(
  toolUseMsg: CoworkMessage,
  toolResultMsg: CoworkMessage | undefined,
  sessionId: string,
): Artifact | null {
  const toolName = toolUseMsg.metadata?.toolName;
  if (!toolName || !WRITE_TOOL_NAMES.has(normalizeToolName(toolName))) {
    return null;
  }

  if (toolResultMsg?.metadata?.isError) {
    return null;
  }

  const toolInput = toolUseMsg.metadata?.toolInput as Record<string, unknown> | undefined;
  if (!toolInput) return null;

  const filePath = extractFilePath(toolInput);
  if (!filePath) return null;

  const ext = getFileExtension(filePath);
  const artifactType = getArtifactTypeFromExtension(ext);
  if (!artifactType) return null;

  const fileName = getFileName(filePath);
  const isImage = isImageExtension(ext);
  const isBinaryDoc = isBinaryDocumentExtension(ext);
  const content =
    isImage || isBinaryDoc ? '' : typeof toolInput.content === 'string' ? toolInput.content : '';

  return {
    id: `artifact-tool-${toolUseMsg.id}`,
    messageId: toolUseMsg.id,
    sessionId,
    type: artifactType,
    title: fileName,
    content,
    fileName,
    filePath,
    source: 'tool',
    role: ArtifactRole.Intermediate,
    createdAt: toolUseMsg.timestamp || Date.now(),
  };
}

export interface DetectedArtifact {
  artifact: Artifact;
  /** If true, the artifact references a file that should be loaded from disk. */
  needsFileLoad: boolean;
}

/**
 * Detect artifacts from a list of Cowork messages.
 *
 * This is a pure function designed to run in a Web Worker. It does not touch
 * the filesystem or Redux — callers are responsible for loading file contents
 * and dispatching artifacts.
 */
export function detectArtifactsFromMessages(
  messages: CoworkMessage[],
  sessionId: string,
): DetectedArtifact[] {
  const detected: DetectedArtifact[] = [];
  const detectedFilePathIndexes = new Map<string, number>();
  const finalAnswerMessageId = findFinalAnswerMessageId(messages);

  const addPathArtifact = (artifact: Artifact, needsFileLoad: boolean) => {
    if (!artifact.filePath) return;

    const normalized = normalizeFilePathForDedup(artifact.filePath);
    const existingIndex = detectedFilePathIndexes.get(normalized);
    if (existingIndex === undefined) {
      detectedFilePathIndexes.set(normalized, detected.length);
      detected.push({ artifact, needsFileLoad });
      return;
    }

    const existing = detected[existingIndex];
    if (
      existing.artifact.role !== ArtifactRole.Deliverable &&
      artifact.role === ArtifactRole.Deliverable
    ) {
      detected[existingIndex] = {
        artifact,
        needsFileLoad: existing.needsFileLoad || needsFileLoad,
      };
    }
  };

  for (const msg of messages) {
    if (msg.type === 'assistant' && !msg.metadata?.isThinking && msg.content) {
      const codeBlockArtifacts = parseCodeBlockArtifacts(msg.content, msg.id, sessionId);
      for (const artifact of codeBlockArtifacts) {
        detected.push({ artifact, needsFileLoad: false });
      }

      const fileRole =
        msg.id === finalAnswerMessageId ? ArtifactRole.Deliverable : ArtifactRole.Intermediate;
      const fileLinks = parseFileLinksFromMessage(msg.content, msg.id, sessionId, fileRole);
      for (const fl of fileLinks) {
        addPathArtifact(fl, true);
      }

      const filePaths = parseFilePathsFromText(
        msg.content,
        msg.id,
        sessionId,
        'artifact-path',
        fileRole,
      );
      for (const artifact of filePaths) {
        addPathArtifact(artifact, true);
      }
    }
  }

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.type === 'tool_use') {
      const toolUseId = msg.metadata?.toolUseId;
      const toolResult = toolUseId
        ? messages.find(m => m.type === 'tool_result' && m.metadata?.toolUseId === toolUseId)
        : messages[i + 1]?.type === 'tool_result'
          ? messages[i + 1]
          : undefined;
      const toolArtifact = parseToolArtifact(msg, toolResult, sessionId);
      if (toolArtifact && toolArtifact.filePath) {
        addPathArtifact(toolArtifact, true);
      } else if (toolArtifact && !toolArtifact.filePath) {
        detected.push({ artifact: toolArtifact, needsFileLoad: false });
      }
    }
  }

  return detected;
}

function findFinalAnswerMessageId(messages: CoworkMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message.type === 'assistant' &&
      !message.metadata?.isThinking &&
      message.metadata?.isFinalAnswer === true &&
      message.content.trim()
    ) {
      return message.id;
    }
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message.type === 'assistant' &&
      !message.metadata?.isThinking &&
      message.metadata?.isStreaming !== true &&
      message.content.trim()
    ) {
      return message.id;
    }
  }

  return null;
}
