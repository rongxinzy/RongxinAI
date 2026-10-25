import { z } from 'zod';

export const COMPANION_MAX_ATTACHMENTS = 10;
export const COMPANION_MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const COMPANION_MAX_ATTACHMENT_NAME_LENGTH = 1024;
const companionAttachment = z
  .object({
    id: z.uuid(),
    name: z.string().min(1).max(COMPANION_MAX_ATTACHMENT_NAME_LENGTH),
    bytes: z.number().int().nonnegative().max(COMPANION_MAX_ATTACHMENT_BYTES),
  })
  .strict();
export const companionAttachments = z.array(companionAttachment).max(COMPANION_MAX_ATTACHMENTS);
export type CompanionAttachment = z.infer<typeof companionAttachment>;

/** One bounded binary transfer; paths and base64 are never accepted from the renderer. */
export const companionIncomingFile = z
  .object({
    name: z.string().min(1).max(COMPANION_MAX_ATTACHMENT_NAME_LENGTH),
    mimeType: z.string().max(255),
    data: z
      .instanceof(Uint8Array)
      .refine(data => data.byteLength <= COMPANION_MAX_ATTACHMENT_BYTES),
  })
  .strict();
export type CompanionIncomingFile = z.infer<typeof companionIncomingFile>;
