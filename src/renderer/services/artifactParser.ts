import { ArtifactRole, type Artifact, type ArtifactType } from '../types/artifact';
import type { CoworkMessage } from '../types/cowork';
import { discoverWorkbenchMessageArtifactBlocks } from '../../shared/workbenchTask';
import {
  ArtifactTypeByExtension,
  getArtifactTypeByExtension,
  isBinaryArtifactFile,
} from '../../shared/cowork/artifactPreview';

const DECLARE_ARTIFACT_TOOL_NAME = 'declare_artifact';

/**
 * Normalize file path for deduplication comparison.
 * Handles Windows file:// URL leading slash and backslash differences.
 */
export function normalizeFilePathForDedup(p: string): string {
  p = p.replace(/^file:\/\/\/?/i, '');
  try {
    p = decodeURIComponent(p);
  } catch {
    // Keep malformed percent-encoded paths unchanged for a stable comparison.
  }
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
  csv: 'document',
  tsv: 'document',
  text: 'text',
  txt: 'text',
  plaintext: 'text',
  model: 'model',
  stl: 'model',
  obj: 'model',
  step: 'model',
  iges: 'model',
};

const IMAGE_EXTENSIONS = new Set(['.png', '.bmp', '.ico', '.jpg', '.jpeg', '.gif', '.webp']);
export function getArtifactTypeFromLanguage(lang: string): ArtifactType | null {
  return LANGUAGE_TO_ARTIFACT_TYPE[lang.toLowerCase()] ?? null;
}

export function getArtifactTypeFromExtension(ext: string): ArtifactType | null {
  return getArtifactTypeByExtension(ext) as ArtifactType | null;
}

export function isImageExtension(ext: string): boolean {
  return IMAGE_EXTENSIONS.has(ext.toLowerCase());
}

export function isBinaryDocumentExtension(ext: string): boolean {
  return isBinaryArtifactFile(`artifact${ext}`);
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
      language: type === 'code' || language === 'csv' || language === 'tsv' ? language : undefined,
      source: 'codeblock',
      role: ArtifactRole.Deliverable,
      createdAt: Date.now(),
    });

    index++;
  }

  return artifacts;
}

export function parseDeclareArtifactFromMessages(
  messages: CoworkMessage[],
  sessionId: string,
  roleForMessage: (msg: CoworkMessage) => ArtifactRole,
): Artifact[] {
  const artifacts: Artifact[] = [];
  let index = 0;

  for (const msg of messages) {
    if (msg.type !== 'tool_use') continue;
    if (msg.metadata?.toolName !== DECLARE_ARTIFACT_TOOL_NAME) continue;

    const input = msg.metadata?.toolInput as Record<string, unknown> | undefined;
    if (!input) continue;

    const filePath = typeof input.filePath === 'string' ? input.filePath.trim() : '';
    if (!filePath) continue;

    const ext = getFileExtension(filePath);
    const declaredKind = typeof input.kind === 'string' ? input.kind.trim() : undefined;
    const artifactType =
      (declaredKind && getArtifactTypeFromLanguage(declaredKind)) ||
      getArtifactTypeFromExtension(ext) ||
      'unsupported';
    const fileName = getFileName(filePath);
    const declaredRole =
      input.role === 'intermediate'
        ? ArtifactRole.Intermediate
        : input.role === 'deliverable'
          ? ArtifactRole.Deliverable
          : roleForMessage(msg);

    const title =
      typeof input.title === 'string' && input.title.trim() ? input.title.trim() : fileName;

    artifacts.push({
      id: `artifact-declare-${msg.id}-${index}`,
      messageId: msg.id,
      sessionId,
      type: artifactType,
      title,
      content: '',
      fileName,
      filePath,
      source: 'tool',
      role: declaredRole,
      declared: true,
      createdAt: msg.timestamp || Date.now(),
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
    case 'unsupported':
      return 'Unsupported File';
    case 'model':
      return '3D Model';
    case 'code':
      return `${language.charAt(0).toUpperCase() + language.slice(1)} Code`;
  }
}

export const WRITE_TOOL_NAMES = new Set(['write', 'writefile', 'write_file']);

export function normalizeToolName(name: string): string {
  return name.toLowerCase().replace(/[_\s]/g, '');
}

export function extractFilePath(toolInput: Record<string, unknown>): string | null {
  for (const key of ['file_path', 'path', 'filePath', 'target_file', 'targetFile']) {
    const val = toolInput[key];
    if (typeof val === 'string' && val.length > 0) {
      return val;
    }
  }
  return null;
}

export function getFileExtension(filePath: string): string {
  const lastDot = filePath.lastIndexOf('.');
  if (lastDot === -1) return '';
  return filePath.slice(lastDot).toLowerCase();
}

export function getFileName(filePath: string): string {
  const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return lastSlash === -1 ? filePath : filePath.slice(lastSlash + 1);
}

const SUPPORTED_ARTIFACT_EXTENSION_PATTERN = Object.keys(ArtifactTypeByExtension)
  .sort((a, b) => b.length - a.length)
  .map(extension => extension.replace('.', '\\.'))
  .join('|');
const FINAL_ANSWER_PATH_PATTERN = new RegExp(
  String.raw`(?:^|[\s(\[{"=>：])((?:file:\/\/\/?[A-Za-z]:[\\/]|[A-Za-z]:[\\/]|\/(?!\/))(?:[^\r\n<>"'])*?(?:${SUPPORTED_ARTIFACT_EXTENSION_PATTERN})(?=$|[\s\])}>,;:!?，。；：！？]))`,
  'gm',
);

function normalizeDetectedPath(rawPath: string): string {
  const withoutFileUrlPrefix = rawPath.replace(/^file:\/\/\/?/i, '');
  try {
    return decodeURIComponent(withoutFileUrlPrefix);
  } catch {
    return withoutFileUrlPrefix;
  }
}

export function parseFinalAnswerPathArtifactsForMessage(
  message: CoworkMessage,
  sessionId: string,
): Artifact[] {
  const artifacts: Artifact[] = [];
  const isFinalAnswer =
    message.type === 'assistant' &&
    !message.metadata?.isThinking &&
    (message.metadata?.isFinalAnswer || message.metadata?.isFinal);
  if (!isFinalAnswer || !message.content) return artifacts;

  for (const match of message.content.matchAll(FINAL_ANSWER_PATH_PATTERN)) {
    const rawPath = match[1];
    if (!rawPath) continue;
    const filePath = normalizeDetectedPath(rawPath);
    const artifactType = getArtifactTypeFromExtension(getFileExtension(filePath));
    if (!artifactType) continue;

    artifacts.push({
      id: `artifact-final-path-${message.id}-${artifacts.length}`,
      messageId: message.id,
      sessionId,
      type: artifactType,
      title: getFileName(filePath),
      content: '',
      fileName: getFileName(filePath),
      filePath,
      source: 'tool',
      role: ArtifactRole.Deliverable,
      declared: false,
      createdAt: message.timestamp || Date.now(),
    });
  }

  return artifacts;
}

function parseFinalAnswerPathArtifacts(messages: CoworkMessage[], sessionId: string): Artifact[] {
  return messages.flatMap(message => parseFinalAnswerPathArtifactsForMessage(message, sessionId));
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
    declared: false,
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
    }
  }

  // Structured artifact declarations from declare_artifact tool calls.
  // These are the authoritative source for file-backed artifacts — no regex.
  const declaredArtifacts = parseDeclareArtifactFromMessages(
    messages,
    sessionId,
    () => ArtifactRole.Deliverable,
  );
  for (const artifact of declaredArtifacts) {
    addPathArtifact(artifact, true);
  }

  // The final answer often names an output path without a preceding explicit
  // declaration. Accept supported absolute paths there, but not paths from
  // streamed reasoning or arbitrary tool output.
  for (const artifact of parseFinalAnswerPathArtifacts(messages, sessionId)) {
    addPathArtifact(artifact, true);
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
