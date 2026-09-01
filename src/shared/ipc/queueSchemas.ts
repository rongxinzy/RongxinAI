import { z } from 'zod';

import { CoworkQueueAttachmentLimit } from '../cowork/pendingMessageQueue';
import { ProductionLoopMode } from '../productionLoop';

export const CoworkQueueSessionSchema = z.string().min(1);

const CoworkQueueImageAttachmentSchema = z.object({
  name: z.string(),
  mimeType: z.string(),
  base64Data: z.string().max(CoworkQueueAttachmentLimit.MaxImageBase64Chars),
});

const CoworkQueueFileAttachmentSchema = z.object({
  name: z.string(),
  path: z.string(),
  extension: z.string(),
  isImage: z.boolean().optional(),
});

export const CoworkQueueEnqueueSchema = z.object({
  sessionId: CoworkQueueSessionSchema,
  text: z.string().trim().min(1).max(100_000),
  imageAttachments: z.array(CoworkQueueImageAttachmentSchema).max(CoworkQueueAttachmentLimit.MaxImages).optional(),
  fileAttachments: z.array(CoworkQueueFileAttachmentSchema).optional(),
  skillIds: z.array(z.string().min(1)).max(32).optional(),
  skillPrompt: z.string().max(100_000).optional(),
  productionLoopMode: z.enum([ProductionLoopMode.Auto, ProductionLoopMode.Off]).optional(),
});

export const CoworkQueueUpdateSchema = z.object({
  sessionId: CoworkQueueSessionSchema,
  itemId: z.string().min(1),
  text: z.string().trim().min(1).max(100_000),
});

export const CoworkQueueItemSchema = z.object({
  sessionId: CoworkQueueSessionSchema,
  itemId: z.string().min(1),
});
