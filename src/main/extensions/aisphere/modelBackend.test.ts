import { expect, test, vi } from 'vitest';
import { AISphere, AISphereError } from '../../../shared/aisphere';
import { startAISphereGateway } from './gateway';
import { createAISphereModelService } from './modelBackend';
import { AISphereService } from './service';

test('serves only verified AISphere models and forwards through the owned gateway', async () => {
  const platform = 'https://aisphere.test';
  const endpoint = `${platform}/inference`;
  const values = new Map<string, unknown>();
  const store = {
    get: <T>(key: string) => values.get(key) as T | undefined,
    set: (key: string, value: unknown) => void values.set(key, value),
  };
  let modelUrl = endpoint;
  const discover = vi.fn(async (url: string) =>
    Response.json(
      url.endsWith(AISphere.VerifyPath)
        ? { data: 'ok' }
        : {
            code: 0,
            model_list: [{ name: 'managed', url: modelUrl, api_key: 'upstream-secret' }],
          },
    ),
  );
  const service = new AISphereService(discover);
  const forward = vi.fn(async () => Response.json({ ok: true }));
  const gateway = await startAISphereGateway(service, forward);
  try {
    await service.initialize(store, gateway.baseUrl, {
      restrictedPlatform: { inferenceOrigins: [] },
    });
    const models = createAISphereModelService(service);
    await expect(models.resolve()).rejects.toThrow();
    await expect(service.connect('https://search.rongxzyai.com.')).rejects.toThrow(
      AISphereError.InvalidAddress,
    );
    expect(discover).not.toHaveBeenCalled();

    await service.connect(platform);
    await expect(models.resolve('external/model')).rejects.toThrow();
    const resolution = await models.resolve();
    expect(resolution.model.id).toBe('managed');
    const body = JSON.stringify({ model: resolution.model.id, messages: [] });
    const response = await fetch(resolution.gatewayUrl + AISphere.ChatPath, {
      method: 'POST',
      headers: { Authorization: `Bearer ${resolution.runtimeApiKey}` },
      body,
    });
    expect(response.status).toBe(200);
    expect(forward).toHaveBeenCalledExactlyOnceWith(
      endpoint,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer upstream-secret' }),
        redirect: 'error',
        requireTrustedCertificate: true,
      }),
    );
    expect(JSON.stringify([...values])).not.toContain(resolution.runtimeApiKey);

    const replacement = 'https://replacement.test';
    modelUrl = `${replacement}/inference`;
    await service.connect(replacement);
    expect((await models.resolve()).runtimeApiKey).not.toBe(resolution.runtimeApiKey);
    const stale = await fetch(resolution.gatewayUrl + AISphere.ChatPath, {
      method: 'POST',
      headers: { Authorization: `Bearer ${resolution.runtimeApiKey}` },
      body,
    });
    expect(stale.status).toBe(403);
    expect(forward).toHaveBeenCalledTimes(1);

    modelUrl = 'https://other.test/inference';
    await expect(service.refresh()).rejects.toThrow(AISphereError.InvalidModels);
    await expect(models.resolve()).rejects.toThrow();
    expect((await models.catalog()).models).toEqual([]);
    expect(forward).toHaveBeenCalledTimes(1);
  } finally {
    await gateway.close();
  }
});
