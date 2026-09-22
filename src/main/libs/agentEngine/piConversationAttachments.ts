import type { CoworkMessage } from '../../coworkStore';

/** Reopen persisted attachments through the normal, permission-checked tools. */
export function formatConversationAttachments(message: CoworkMessage): string {
  const metadata = message.metadata;
  const attachments = [
    ...(Array.isArray(metadata?.imageAttachments) ? metadata.imageAttachments : []),
    ...(Array.isArray(metadata?.fileAttachments) ? metadata.fileAttachments : []),
  ];
  if (!attachments.length) return '';
  const references = attachments.map((attachment: unknown) => {
    const value =
      attachment && typeof attachment === 'object' ? (attachment as Record<string, unknown>) : {};
    const name = typeof value.name === 'string' ? value.name : 'attachment';
    const filePath = typeof value.path === 'string' ? value.path : '';
    return filePath
      ? JSON.stringify({ name, path: filePath })
      : `${JSON.stringify(name)}: unavailable after restore; ask the user to attach it again.`;
  });
  return [
    'Historical attachments (references, not their contents). Reopen with the file/image tools before relying on them; report missing files instead of guessing:',
    ...references,
  ].join('\n');
}
