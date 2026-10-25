import { z } from 'zod';
import { MemoryKind } from '../memory/constants';

export const companionMemorySave = z
  .object({
    petId: z.uuid(),
    requestId: z.string().trim().min(1).max(128),
    title: z.string().trim().min(1).max(120),
    content: z.string().trim().min(1).max(3000),
    kind: z.enum([MemoryKind.Preference, MemoryKind.Decision]),
    replacesId: z.string().min(1).max(128).optional(),
  })
  .strict();

export const companionMemoryShare = z
  .object({
    petId: z.uuid(),
    id: z.string().min(1).max(128),
    requestId: z.string().trim().min(1).max(128),
    confirmed: z.literal(true),
  })
  .strict();
export type CompanionMemorySave = z.infer<typeof companionMemorySave>;
export type CompanionMemoryShare = z.infer<typeof companionMemoryShare>;

export const companionMemoryConfirm = z
  .object({
    petId: z.uuid(),
    id: z.string().min(1).max(128),
    title: z.string().min(1).max(120),
    content: z.string().min(1).max(3000),
    kind: z.enum([MemoryKind.Preference, MemoryKind.Decision]),
    confirmed: z.literal(true),
  })
  .strict();
export type CompanionMemoryConfirm = z.infer<typeof companionMemoryConfirm>;
