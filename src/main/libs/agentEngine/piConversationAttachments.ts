import type { CoworkMessage } from '../../coworkStore';
import { collectImagePathReferences } from './piImageInputFallback';

/**
 * Reopen persisted attachments through the normal, permission-checked tools.
 *
 * A rebuilt session replays images as paths only, so a model that cannot read
 * image bytes would otherwise be left to invent its own extraction path; when
 * the bundled OCR helper is available the command that works travels with the
 * reference.
 */
export function formatConversationAttachments(
  message: CoworkMessage,
  ocrCommandFor?: (imagePath: string) => string,
): string {
  const metadata = message.metadata;
  const attachments = [
    ...(Array.isArray(metadata?.imageAttachments) ? metadata.imageAttachments : []),
    ...(Array.isArray(metadata?.fileAttachments) ? metadata.fileAttachments : []),
  ];
  if (!attachments.length) return '';
  const imagePaths = new Set(
    collectImagePathReferences(
      attachments as Array<{ name?: string; path?: string; isImage?: boolean }>,
    ).map(reference => reference.path),
  );
  const references = attachments.map((attachment: unknown) => {
    const value =
      attachment && typeof attachment === 'object' ? (attachment as Record<string, unknown>) : {};
    const name = typeof value.name === 'string' ? value.name : 'attachment';
    const filePath = typeof value.path === 'string' ? value.path : '';
    if (!filePath) {
      return `${JSON.stringify(name)}: unavailable after restore; ask the user to attach it again.`;
    }
    const reference = JSON.stringify({ name, path: filePath });
    const command = imagePaths.has(filePath) ? ocrCommandFor?.(filePath) : undefined;
    return command ? `${reference}\n  text extraction: ${command}` : reference;
  });
  return [
    'Historical attachments (references, not their contents). Reopen with the file/image tools before relying on them; report missing files instead of guessing:',
    ...references,
  ].join('\n');
}
