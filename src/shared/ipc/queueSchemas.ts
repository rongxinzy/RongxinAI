import { z } from 'zod';

export const CoworkQueueSessionSchema = z.string().min(1);

export const CoworkQueueEnqueueSchema = z.object({
  sessionId: CoworkQueueSessionSchema,
  text: z.string().trim().min(1).max(100_000),
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
