import { describe, expect, test } from 'vitest';
import { z } from 'zod';

import { ollamaContract } from './ollamaContract';
import { ollamaContractChannels } from './ollamaContract.channels';
import { OllamaIpcChannel } from '../ollama/constants';
import type { IpcContract } from './contract';

test('every method binds its documented channel constant', () => {
  const expected: Record<keyof typeof ollamaContract, string> = {
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
  for (const [method, channel] of Object.entries(expected)) {
    expect(ollamaContract[method as keyof typeof ollamaContract].channel).toBe(channel);
    expect(ollamaContractChannels[method as keyof typeof ollamaContractChannels]).toBe(channel);
  }
});

describe('schema acceptance', () => {
  const parseArgs = (method: keyof typeof ollamaContract, ...args: unknown[]) =>
    (ollamaContract[method].args as unknown as z.ZodTuple).safeParse(args);

  test('status snapshot round-trips with optional fields intact', () => {
    const snapshot = {
      status: 'running',
      version: '0.9',
      pid: 42,
      managedByApp: true,
      checkedAt: new Date().toISOString(),
    };
    expect(ollamaContract.status.result.safeParse(snapshot).success).toBe(true);
  });

  test('chat payload requires a model and at least one message', () => {
    const payload = {
      model: 'qwen',
      messages: [{ role: 'user', content: 'hi' }],
      options: { temperature: 0.2 },
    };
    expect(parseArgs('chat', payload).success).toBe(true);
    expect(parseArgs('chat', { model: 'qwen', messages: [] }).success).toBe(false);
    expect(parseArgs('chat', { messages: [{ role: 'user', content: 'hi' }] }).success).toBe(false);
  });

  test('service config accepts only the documented knobs', () => {
    expect(parseArgs('setServiceConfig', { numParallel: '2', schedSpread: true }).success).toBe(
      true,
    );
    expect(parseArgs('setServiceConfig', 'not-an-object').success).toBe(false);
  });

  test('model launch input keeps open numeric options', () => {
    const input = { model: 'qwen', options: { num_ctx: 8192, num_gpu: 99 } };
    expect(parseArgs('preloadModel', input).success).toBe(true);
  });

  test('model entries pass through unknown upstream fields', () => {
    const model = { name: 'qwen', details: { family: 'qwen2', extra: 1 }, new_field: true };
    expect(ollamaContract.listLocalModels.result.safeParse([model]).success).toBe(true);
  });
});

test('the channel map matches the contract method set', () => {
  const contract = ollamaContract as IpcContract;
  expect(Object.keys(ollamaContractChannels).sort()).toEqual(Object.keys(contract).sort());
});
