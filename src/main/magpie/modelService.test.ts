import { describe, it, expect, vi } from 'vitest';
import { MagpieModelService } from './modelService';
import type { MagpieStatus } from '../../shared/magpie/types';
function fixture() {
  let state: MagpieStatus = {
    state: 'running',
    version: 'test',
    gatewayUrl: 'http://127.0.0.1:1234',
  };
  let selected: string | undefined;
  const backend = {
    status: () => state,
    models: vi.fn(async () => [{ id: 'vendor/model' }, { id: 'private/model' }]),
  };
  const beforeCatalog = vi.fn(async () => {});
  const service = new MagpieModelService(backend, {
    readDefaultModelId: () => selected,
    writeDefaultModelId: id => {
      selected = id;
    },
    beforeCatalog,
    allowedModel: model => model.id !== 'private/model',
  });
  return {
    service,
    backend,
    beforeCatalog,
    setState: (s: MagpieStatus) => {
      state = s;
    },
  };
}
describe('single authoritative model service', () => {
  it('accepts a selected unified model without a legacy provider configuration or credential projection', async () => {
    const f = fixture();
    await f.service.selectDefault('vendor/model');
    expect(await f.service.checkReadiness()).toEqual({ hasConfig: true, config: null });
  });
  it('fails readiness when the selected model is revoked by the managed policy', async () => {
    const f = fixture();
    await f.service.selectDefault('vendor/model');
    f.backend.models.mockResolvedValue([{ id: 'private/model' }]);
    expect(await f.service.checkReadiness()).toEqual({
      hasConfig: false,
      config: null,
      error: expect.stringContaining('no longer available'),
    });
  });
  it('requires an explicit default model for readiness', async () => {
    const f = fixture();
    expect(await f.service.checkReadiness()).toEqual({
      hasConfig: false,
      config: null,
      error: expect.stringContaining('default model'),
    });
  });
  it('rejects readiness when the service is disabled without reading providers', async () => {
    const f = fixture();
    f.setState({ state: 'stopped', version: 'test' });
    expect(await f.service.checkReadiness()).toEqual({
      hasConfig: false,
      config: null,
      error: expect.stringContaining('Enable'),
    });
    expect(f.backend.models).not.toHaveBeenCalled();
  });
  it('requires an explicit selection and never falls back to the first or a legacy provider', async () => {
    const f = fixture();
    await expect(f.service.resolve()).rejects.toThrow('default model');
    await f.service.selectDefault('vendor/model');
    expect((await f.service.resolve()).model.id).toBe('vendor/model');
    f.backend.models.mockResolvedValue([]);
    await expect(f.service.resolve()).rejects.toThrow('no longer available');
  });
  it('enforces managed policy on selection and explicit session overrides', async () => {
    const f = fixture();
    await expect(f.service.selectDefault('private/model')).rejects.toThrow('unavailable');
    await expect(f.service.resolve('private/model')).rejects.toThrow('restricted');
    expect((await f.service.catalog()).models).toEqual([{ id: 'vendor/model' }]);
  });
  it('never starts a stopped service or accesses upstream providers on a read', async () => {
    const f = fixture();
    f.setState({ state: 'stopped', version: 'test' });
    expect((await f.service.catalog()).models).toEqual([]);
    expect(f.beforeCatalog).not.toHaveBeenCalled();
    expect(f.backend.models).not.toHaveBeenCalled();
    await expect(f.service.resolve('vendor/model')).rejects.toThrow('Enable');
  });
  it('rejects a process change while the catalog is being read', async () => {
    const f = fixture();
    f.backend.models.mockImplementation(async () => {
      f.setState({ state: 'failed', version: 'test' });
      return [{ id: 'vendor/model' }];
    });
    await expect(f.service.catalog()).rejects.toThrow('changed');
  });
});

it('only actual model resolution requests an authorized lazy startup', async () => {
  let status: MagpieStatus = { state: 'stopped', version: 'test', enabled: true };
  const ensureRunning = vi.fn(async () => {
    status = { ...status, state: 'running', gatewayUrl: 'http://127.0.0.1:1234' };
    return status;
  });
  const service = new MagpieModelService(
    { status: () => status, models: async () => [{ id: 'fixture/model' }], ensureRunning },
    {
      readDefaultModelId: () => 'fixture/model',
      writeDefaultModelId: () => {},
    },
  );
  await service.catalog();
  expect(ensureRunning).not.toHaveBeenCalled();
  expect((await service.resolve()).model.id).toBe('fixture/model');
  expect(ensureRunning).toHaveBeenCalledTimes(1);
});
