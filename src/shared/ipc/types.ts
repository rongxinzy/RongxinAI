/**
 * TypeScript types derived from IPC Zod schemas.
 *
 * These types are inferred from the schemas so that preload and main
 * share a single source of truth without manual type duplication.
 */

import type { z } from 'zod';

import type {
  CoworkConfigSetSchema,
  CoworkMemoryCreateEntrySchema,
  CoworkMemoryDeleteEntrySchema,
  CoworkMemoryListEntriesSchema,
  CoworkMemoryUpdateEntrySchema,
  CoworkPermissionRespondSchema,
  CoworkSessionCaptureImageChunkSchema,
  CoworkSessionContinueSchema,
  CoworkSessionExportResultImageSchema,
  CoworkSessionExportTextSchema,
  CoworkSessionGetMessagesSchema,
  CoworkSessionListSchema,
  CoworkSessionPinSchema,
  CoworkSessionRenameSchema,
  CoworkSessionSaveResultImageSchema,
  CoworkSessionStartSchema,
} from './schemas';

// ─── Cowork ─────────────────────────────────────────────────────────────────

export type CoworkSessionStartInput = z.infer<typeof CoworkSessionStartSchema.input>;
export type CoworkSessionContinueInput = z.infer<typeof CoworkSessionContinueSchema.input>;
export type CoworkSessionListInput = z.infer<typeof CoworkSessionListSchema.input>;
export type CoworkSessionGetMessagesInput = z.infer<typeof CoworkSessionGetMessagesSchema.input>;
export type CoworkSessionPinInput = z.infer<typeof CoworkSessionPinSchema.input>;
export type CoworkSessionRenameInput = z.infer<typeof CoworkSessionRenameSchema.input>;
export type CoworkSessionExportResultImageInput = z.infer<
  typeof CoworkSessionExportResultImageSchema.input
>;
export type CoworkSessionCaptureImageChunkInput = z.infer<
  typeof CoworkSessionCaptureImageChunkSchema.input
>;
export type CoworkSessionSaveResultImageInput = z.infer<
  typeof CoworkSessionSaveResultImageSchema.input
>;
export type CoworkSessionExportTextInput = z.infer<typeof CoworkSessionExportTextSchema.input>;
export type CoworkPermissionRespondInput = z.infer<typeof CoworkPermissionRespondSchema.input>;
export type CoworkConfigSetInput = z.infer<typeof CoworkConfigSetSchema.input>;
export type CoworkMemoryListEntriesInput = z.infer<typeof CoworkMemoryListEntriesSchema.input>;
export type CoworkMemoryCreateEntryInput = z.infer<typeof CoworkMemoryCreateEntrySchema.input>;
export type CoworkMemoryUpdateEntryInput = z.infer<typeof CoworkMemoryUpdateEntrySchema.input>;
export type CoworkMemoryDeleteEntryInput = z.infer<typeof CoworkMemoryDeleteEntrySchema.input>;

/** IPC success envelope with optional data fields. */
export type IpcSuccessPayload<T extends Record<string, unknown> = Record<string, never>> = {
  success: true;
} & T;

/** IPC error envelope. */
export interface IpcErrorPayload {
  success: false;
  error?: string;
}

/** Union of success and error for handlers that follow the { success, ... } pattern. */
export type IpcResultPayload<T extends Record<string, unknown> = Record<string, never>> =
  | IpcSuccessPayload<T>
  | IpcErrorPayload;
