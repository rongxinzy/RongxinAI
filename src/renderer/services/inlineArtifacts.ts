import { discoverWorkbenchMessageArtifactBlocks } from '../../shared/workbenchTask';
import {
  ArtifactTypeByLanguage,
  getInlineArtifactRole,
  getInlineArtifactLanguage,
} from '../../shared/cowork/artifactClassification';
import type { Artifact, ArtifactType } from '../types/artifact';
import type { CoworkMessage } from '../types/cowork';

/**
 * Inline code-block artifacts (```html / ```svg / ```mermaid / explicit
 * ```artifact:... blocks) live inside assistant message text, so they are the
 * only artifacts the renderer still projects by itself. File-backed artifacts
 * come from the main-process ledger (PR1).
 */

function getArtifactTypeFromLanguage(lang: string): ArtifactType | null {
  return ArtifactTypeByLanguage[lang.toLowerCase()] ?? null;
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

export function parseCodeBlockArtifacts(
  messageContent: string,
  messageId: string,
  sessionId: string,
): Artifact[] {
  if (!messageContent) return [];

  const artifacts: Artifact[] = [];

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
      id: `artifact-${messageId}-${block.index}`,
      messageId,
      sessionId,
      type,
      title,
      content,
      language: getInlineArtifactLanguage(type, language),
      source: 'codeblock',
      role: getInlineArtifactRole(isExplicitArtifact),
      createdAt: Date.now(),
    });
  }

  return artifacts;
}

/**
 * Projects the inline code-block artifacts of loaded assistant messages.
 * Settled projection only: thinking and still-streaming messages are skipped,
 * so a message contributes artifacts once its text is final.
 */
export function collectInlineArtifacts(
  messages: readonly CoworkMessage[],
  sessionId: string,
): Artifact[] {
  const artifacts: Artifact[] = [];
  for (const message of messages) {
    if (message.type !== 'assistant') continue;
    if (message.metadata?.isThinking || message.metadata?.isStreaming) continue;
    if (!message.content) continue;
    artifacts.push(...parseCodeBlockArtifacts(message.content, message.id, sessionId));
  }
  return artifacts;
}
