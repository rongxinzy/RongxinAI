/**
 * Ollama IPC contract (work package M.4): the twenty invoke methods of the
 * Ollama runtime surface, bound to one zod-backed definition shared by the
 * main handlers, the preload invokers and the renderer types. Push channels
 * (status/install/pull/chat-stream notifications) stay outside — pushes do
 * not go through the invoke contract.
 */
import { z } from 'zod';

import { OllamaIpcChannel } from '../ollama/constants';
import { defineIpcContract } from './contract';

const OllamaServerStatusSchema = z.enum([
  'unknown',
  'not-installed',
  'installing',
  'installed',
  'starting',
  'running',
  'stopped',
  'error',
]);

const StatusSnapshotSchema = z
  .object({
    status: OllamaServerStatusSchema,
    version: z.string().optional(),
    executablePath: z.string().optional(),
    pid: z.number().optional(),
    managedByApp: z.boolean().optional(),
    error: z.string().optional(),
    checkedAt: z.string(),
  })
  .passthrough();

const ServiceConfigSchema = z
  .object({
    cudaVisibleDevices: z.string().optional(),
    maxLoadedModels: z.string().optional(),
    numParallel: z.string().optional(),
    schedSpread: z.boolean().optional(),
  })
  .passthrough();

const ModelSchema = z
  .object({
    name: z.string(),
    model: z.string().optional(),
    modified_at: z.string().optional(),
    size: z.number().optional(),
    digest: z.string().optional(),
    details: z
      .object({
        parent_model: z.string().optional(),
        format: z.string().optional(),
        family: z.string().optional(),
        families: z.array(z.string()).optional(),
        parameter_size: z.string().optional(),
        quantization_level: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const RunningModelSchema = ModelSchema.extend({
  expires_at: z.string().optional(),
  size_vram: z.number().optional(),
  context_length: z.number().optional(),
});

const ModelLaunchInputSchema = z
  .object({
    model: z.string(),
    keep_alive: z.union([z.string(), z.number()]).optional(),
    options: z
      .object({
        num_ctx: z.number().optional(),
        num_batch: z.number().optional(),
        num_gpu: z.number().optional(),
        main_gpu: z.number().optional(),
        use_mmap: z.boolean().optional(),
        num_thread: z.number().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const ModelLaunchResultSchema = z.object({
  success: z.literal(true),
  runningModels: z.array(RunningModelSchema),
});

const ChatPayloadSchema = z
  .object({
    model: z.string(),
    messages: z
      .array(
        z
          .object({
            role: z.enum(['system', 'user', 'assistant', 'tool']),
            content: z.string(),
            thinking: z.string().optional(),
            tool_name: z.string().optional(),
          })
          .passthrough(),
      )
      .min(1),
    stream: z.boolean().optional(),
    keep_alive: z.union([z.string(), z.number()]).optional(),
    think: z.union([z.boolean(), z.enum(['high', 'medium', 'low'])]).optional(),
    options: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const SuccessSchema = z.object({ success: z.literal(true) });

const CancelResultSchema = z.object({
  success: z.literal(true),
  cancelled: z.boolean(),
});

const UnloadResultSchema = z.object({
  success: z.literal(true),
  runningModels: z.array(RunningModelSchema),
});

export const ollamaContract = defineIpcContract({
  status: { channel: OllamaIpcChannel.Status, args: z.tuple([]), result: StatusSnapshotSchema },
  install: { channel: OllamaIpcChannel.Install, args: z.tuple([]), result: StatusSnapshotSchema },
  start: { channel: OllamaIpcChannel.Start, args: z.tuple([]), result: StatusSnapshotSchema },
  stop: { channel: OllamaIpcChannel.Stop, args: z.tuple([]), result: StatusSnapshotSchema },
  restart: { channel: OllamaIpcChannel.Restart, args: z.tuple([]), result: StatusSnapshotSchema },
  getServiceConfig: {
    channel: OllamaIpcChannel.GetServiceConfig,
    args: z.tuple([]),
    result: ServiceConfigSchema,
  },
  setServiceConfig: {
    channel: OllamaIpcChannel.SetServiceConfig,
    args: z.tuple([ServiceConfigSchema]),
    result: ServiceConfigSchema,
  },
  modelsDir: { channel: OllamaIpcChannel.ModelsDir, args: z.tuple([]), result: z.string() },
  listLocalModels: {
    channel: OllamaIpcChannel.ListLocalModels,
    args: z.tuple([]),
    result: z.array(ModelSchema),
  },
  listRunningModels: {
    channel: OllamaIpcChannel.ListRunningModels,
    args: z.tuple([]),
    result: z.array(RunningModelSchema),
  },
  deleteModel: {
    channel: OllamaIpcChannel.DeleteModel,
    args: z.tuple([z.string()]),
    result: SuccessSchema,
  },
  showModel: {
    channel: OllamaIpcChannel.ShowModel,
    args: z.tuple([z.string()]),
    // The Ollama show payload is an open document; the renderer renders
    // selected fields and tolerates upstream additions.
    result: z.record(z.string(), z.unknown()),
  },
  createModel: {
    channel: OllamaIpcChannel.CreateModel,
    args: z.tuple([z.string(), z.string()]),
    result: SuccessSchema,
  },
  preloadModel: {
    channel: OllamaIpcChannel.PreloadModel,
    args: z.tuple([ModelLaunchInputSchema]),
    result: ModelLaunchResultSchema,
  },
  unloadModel: {
    channel: OllamaIpcChannel.UnloadModel,
    args: z.tuple([z.string()]),
    result: UnloadResultSchema,
  },
  pullModel: {
    channel: OllamaIpcChannel.PullModel,
    args: z.tuple([z.string()]),
    result: SuccessSchema,
  },
  cancelPull: {
    channel: OllamaIpcChannel.CancelPull,
    args: z.tuple([z.string()]),
    result: CancelResultSchema,
  },
  chat: {
    channel: OllamaIpcChannel.Chat,
    args: z.tuple([ChatPayloadSchema]),
    // One assembled chat response document; open like showModel.
    result: z.record(z.string(), z.unknown()),
  },
  chatStream: {
    channel: OllamaIpcChannel.ChatStream,
    args: z.tuple([z.string(), ChatPayloadSchema]),
    result: SuccessSchema,
  },
  cancelChatStream: {
    channel: OllamaIpcChannel.CancelChatStream,
    args: z.tuple([z.string()]),
    result: CancelResultSchema,
  },
});
