/**
 * Channel map for the Ollama IPC contract, importable by the sandboxed
 * preload (zod-free; see contract.ts layering notes).
 */
import type { IpcContractChannels } from './contract';
import type { ollamaContract } from './ollamaContract';
import { OllamaIpcChannel } from '../ollama/constants';

export const ollamaContractChannels: IpcContractChannels<typeof ollamaContract> = {
  status: OllamaIpcChannel.Status,
  install: OllamaIpcChannel.Install,
  start: OllamaIpcChannel.Start,
  stop: OllamaIpcChannel.Stop,
  restart: OllamaIpcChannel.Restart,
  getServiceConfig: OllamaIpcChannel.GetServiceConfig,
  setServiceConfig: OllamaIpcChannel.SetServiceConfig,
  modelsDir: OllamaIpcChannel.ModelsDir,
  listLocalModels: OllamaIpcChannel.ListLocalModels,
  listRunningModels: OllamaIpcChannel.ListRunningModels,
  deleteModel: OllamaIpcChannel.DeleteModel,
  showModel: OllamaIpcChannel.ShowModel,
  createModel: OllamaIpcChannel.CreateModel,
  preloadModel: OllamaIpcChannel.PreloadModel,
  unloadModel: OllamaIpcChannel.UnloadModel,
  pullModel: OllamaIpcChannel.PullModel,
  cancelPull: OllamaIpcChannel.CancelPull,
  chat: OllamaIpcChannel.Chat,
  chatStream: OllamaIpcChannel.ChatStream,
  cancelChatStream: OllamaIpcChannel.CancelChatStream,
};
