import { z } from 'zod';

export const COMPANION_MAX_ATTACHMENTS = 10;
export const COMPANION_MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const companionAttachment = z
  .object({
    id: z.uuid(),
    name: z.string().min(1).max(1024),
    bytes: z.number().int().nonnegative().max(COMPANION_MAX_ATTACHMENT_BYTES),
  })
  .strict();
export const companionAttachments = z.array(companionAttachment).max(COMPANION_MAX_ATTACHMENTS);
export type CompanionAttachment = z.infer<typeof companionAttachment>;
