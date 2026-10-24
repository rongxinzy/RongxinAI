import { expect, test, vi } from 'vitest';
import type { MagpieModel, MagpieStatus } from '../../shared/magpie/types';
import { CompanionCapability, CompanionUnavailableReason } from '../../shared/companion/constants';
import { MagpieModelService } from '../magpie/modelService';
import { CompanionModelAssignment } from './modelAssignment.mjs';

function fixture() {
  let status: MagpieStatus = {
    state: 'running',
    gatewayUrl: 'http://127.0.0.1:1234',
    version: 'test',
  };
  let models: MagpieModel[] = [{ id: 'a' }, { id: 'b' }];
  let defaultId: string | null = null;
  const write = vi.fn();
  const start = vi.fn(async () => {
    status = { ...status, state: 'running', gatewayUrl: 'http://127.0.0.1:1234' };
    return status;
  });
  const beforeCatalog = vi.fn(async () => {});
  const service = new MagpieModelService(
    { status: () => status, models: async () => models, ensureRunning: start },
    {
      readDefaultModelId: () => defaultId,
      writeDefaultModelId: write,
      beforeCatalog,
      allowedModel: model => model.id !== 'private',
    },
  );
  let now = 1000;
  const assignment = new CompanionModelAssignment(service, () => now);
  return {
    assignment,
    service,
    write,
    start,
    beforeCatalog,
    setDefault: (value: string | null) => {
      defaultId = value;
    },
    setStatus: (value: MagpieStatus) => {
      status = value;
    },
    setModels: (value: MagpieModel[]) => {
      models = value;
    },
    advance: () => {
      now += 60_001;
    },
  };
}

test('uses the global default when available and auto assigns without rewriting it', async () => {
  const f = fixture();
  expect((await f.assignment.resolve('pet')).availability.modelId).toBe('a');
  f.setDefault('b');
  expect((await f.assignment.resolve('pet')).availability.modelId).toBe('b');
  f.setDefault('removed');
  expect((await f.assignment.resolve('pet')).availability.modelId).toBe('a');
  expect(f.write).not.toHaveBeenCalled();
});

test('does not start or discover accounts for a service without existing consent', async () => {
  const f = fixture();
  for (const enabled of [undefined, false]) {
    f.setStatus({ state: 'stopped', version: 'test', enabled });
    expect((await f.assignment.resolve('pet')).availability.capability).toBe(
      CompanionCapability.Local,
    );
  }
  expect(f.start).not.toHaveBeenCalled();
  expect(f.beforeCatalog).not.toHaveBeenCalled();
});

test('an explicit companion request can start a previously enabled service', async () => {
  const f = fixture();
  f.setStatus({ state: 'stopped', version: 'test', enabled: true });
  expect((await f.assignment.resolve('pet')).availability.capability).toBe(
    CompanionCapability.Chat,
  );
  expect(f.start).toHaveBeenCalledTimes(1);
});

test('stops assigning when service consent is revoked before its process has exited', async () => {
  const f = fixture();
  f.setStatus({
    state: 'running',
    gatewayUrl: 'http://127.0.0.1:1234',
    version: 'test',
    enabled: false,
  });
  expect((await f.assignment.resolve('pet')).availability.capability).toBe(
    CompanionCapability.Local,
  );
  expect(f.beforeCatalog).not.toHaveBeenCalled();
});

test('policy restrictions and non-chat modalities apply to automatic assignment', async () => {
  const f = fixture();
  f.setDefault('private');
  f.setModels([
    { id: 'private' },
    { id: 'image', modalities: { input: ['text'], output: ['image'] } },
    { id: 'embedding', native_endpoints: ['/v1/embeddings'] },
  ]);
  expect((await f.assignment.resolve('pet')).availability.reason).toBe(
    CompanionUnavailableReason.NoModel,
  );
});

test('failed models cool down with bounded fallback, and can recover after expiry', async () => {
  const f = fixture();
  f.setDefault('b');
  f.assignment.failed('b');
  expect((await f.assignment.resolve('pet')).availability.modelId).toBe('a');
  f.assignment.failed('a');
  expect((await f.assignment.resolve('pet')).availability.reason).toBe(
    CompanionUnavailableReason.ModelFailed,
  );
  f.advance();
  expect((await f.assignment.resolve('pet')).availability.modelId).toBe('b');
});

test('does not infer tools from catalog presence; visual support requires a declared modality', async () => {
  const f = fixture();
  expect((await f.assignment.resolve('pet')).availability).toMatchObject({
    toolUse: false,
    imageInput: false,
  });
  f.setModels([{ id: 'vision', modalities: { input: ['text', 'image'], output: ['text'] } }]);
  expect((await f.assignment.resolve('pet')).availability).toMatchObject({
    toolUse: false,
    imageInput: true,
  });
});
