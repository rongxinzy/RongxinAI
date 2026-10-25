import { z } from 'zod';
import { CompanionIpc as IpcChannel } from '../ipc/channels';
import { defineIpcContract } from '../ipc/contract';
import { DesktopPetBuiltinId } from '../desktopPet/catalog';
import { companionAttachments } from './attachments';
import { companionMemorySave, companionMemoryShare, companionMemoryConfirm } from './memory';
import { ManagedMemoryRecordSchema } from '../ipc/memoryContract';
import { CompanionBubbleSide } from './bubble';
import {
  companionTaskRequest,
  companionTaskProjection,
  companionTaskResult,
  companionWorkspace,
  companionTaskSnapshot,
} from './tasks';
import {
  CompanionCapability,
  CompanionRequestState,
  CompanionUnavailableReason,
} from './constants';

const profile = z.object({
  petId: z.uuid(),
  personaId: z.enum(Object.values(DesktopPetBuiltinId)),
  characterId: z.enum(Object.values(DesktopPetBuiltinId)),
  createdAt: z.number(),
});
const receipt = z
  .object({
    petId: z.uuid(),
    requestId: z.string().min(1).max(128),
    submissionId: z.number().int().positive(),
  })
  .strict();
const availability = z.object({
  capability: z.enum(Object.values(CompanionCapability)),
  modelId: z.string().nullable(),
  imageInput: z.boolean(),
  toolUse: z.boolean(),
  reason: z.enum(Object.values(CompanionUnavailableReason)).optional(),
});
const context = z.object({
  language: z.enum(['zh', 'en']),
  theme: z.enum(['light', 'dark', 'system']),
  themeStyle: z.string(),
  bubble: z
    .object({
      side: z.enum(Object.values(CompanionBubbleSide)),
      anchorX: z.number().finite().nonnegative(),
    })
    .optional(),
});
const state = z.object({
  context,
  activePetId: z.uuid(),
  profiles: z.array(profile),
  availability,
  shortcutAvailable: z.boolean(),
  workspaces: z.array(companionWorkspace),
  tasks: z.array(companionTaskProjection),
  taskRevision: z.number().int().nonnegative(),
  conversation: z.object({
    messages: z.array(
      z.object({ id: z.number(), role: z.enum(['user', 'assistant']), text: z.string() }),
    ),
    pending: receipt.nullable(),
  }),
});
export const companionContract = defineIpcContract({
  visibility: { channel: IpcChannel.GetVisibility, args: z.tuple([]), result: z.boolean() },
  listMemories: {
    channel: IpcChannel.ListMemories,
    args: z.tuple([z.uuid()]),
    result: z.array(ManagedMemoryRecordSchema),
  },
  saveMemory: {
    channel: IpcChannel.SaveMemory,
    args: z.tuple([companionMemorySave]),
    result: ManagedMemoryRecordSchema,
  },
  confirmMemory: {
    channel: IpcChannel.ConfirmMemory,
    args: z.tuple([companionMemoryConfirm]),
    result: ManagedMemoryRecordSchema,
  },
  forgetMemory: {
    channel: IpcChannel.ForgetMemory,
    args: z.tuple([z.uuid(), z.string().min(1).max(128)]),
    result: z.boolean(),
  },
  shareMemory: {
    channel: IpcChannel.ShareMemory,
    args: z.tuple([companionMemoryShare]),
    result: z.object({ id: z.string(), available: z.boolean() }),
  },
  bootstrap: { channel: IpcChannel.Bootstrap, args: z.tuple([]), result: state },
  select: { channel: IpcChannel.Select, args: z.tuple([z.uuid()]), result: state },
  submit: {
    channel: IpcChannel.Submit,
    args: z.tuple([
      z
        .object({
          petId: z.uuid(),
          requestId: z.string().trim().min(1).max(128),
          text: z.string().trim().min(1).max(32_000),
        })
        .strict(),
    ]),
    result: z.object({ availability, receipt: receipt.nullable() }),
  },
  answer: {
    channel: IpcChannel.Answer,
    args: z.tuple([receipt]),
    result: receipt.extend({
      state: z.enum(Object.values(CompanionRequestState)),
      text: z.string(),
    }),
  },
  stop: { channel: IpcChannel.Stop, args: z.tuple([z.uuid()]), result: z.void() },
  submitTask: {
    channel: IpcChannel.SubmitTask,
    args: z.tuple([companionTaskRequest]),
    result: companionTaskResult,
  },
  tasks: { channel: IpcChannel.Tasks, args: z.tuple([]), result: companionTaskSnapshot },
  chooseWorkspace: {
    channel: IpcChannel.ChooseWorkspace,
    args: z.tuple([]),
    result: companionWorkspace.nullable(),
  },
  chooseFiles: {
    channel: IpcChannel.ChooseFiles,
    args: z.tuple([z.uuid()]),
    result: companionAttachments,
  },
  stopTask: { channel: IpcChannel.StopTask, args: z.tuple([z.uuid()]), result: z.void() },
  hide: { channel: IpcChannel.Hide, args: z.tuple([]), result: z.void() },
  openWorkbench: {
    channel: IpcChannel.OpenWorkbench,
    args: z.tuple([z.uuid().optional()]),
    result: z.void(),
  },
});
