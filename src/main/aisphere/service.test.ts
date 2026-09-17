import { afterEach, expect, test, vi } from 'vitest';
import { AISphere, AISphereError, AISphereStatus } from '../../shared/aisphere';
import { AISphereService } from './service';
import { normalizePlatformAddress, parsePlatformModels } from './catalog';

const model = {
  name: 'model-a',
  url: 'http://inference.test/full/chat/completions',
  api_key: 'secret-a',
  tool_call: false,
  image: false,
  thinking: false,
  video: false,
  context_length: 262144,
  max_input: 0,
  max_output: 0,
};
const services: AISphereService[] = [];
function setup() {
  const values = new Map<string, unknown>();
  const store = {
    get: <T>(key: string) => values.get(key) as T | undefined,
    set: (key: string, value: unknown) => {
      values.set(key, value);
    },
  };
  let catalog = [model];
  const fetcher = vi.fn(async (url: string) =>
    Response.json(
      url.endsWith(AISphere.VerifyPath) ? { data: 'ok' } : { code: 0, model_list: catalog },
    ),
  );
  const service = new AISphereService(fetcher);
  services.push(service);
  return {
    values,
    store,
    fetcher,
    service,
    setModels: (models: typeof catalog) => {
      catalog = models;
    },
  };
}
afterEach(() => {
  services.splice(0).forEach(service => service.dispose());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test('recovers discovery after a startup outage without a request or manual refresh', async () => {
  vi.useFakeTimers();
  const { service, store, values, fetcher } = setup();
  values.set(AISphere.StoreKey, 'http://platform.test');
  fetcher.mockRejectedValueOnce(new Error('offline'));
  await service.initialize(store, 'http://127.0.0.1:1234');
  expect(() => service.selection(model.name)).toThrow(AISphereError.Unavailable);
  const changed = vi.fn();
  service.onChanged(changed);
  await vi.advanceTimersByTimeAsync(5000);
  expect(service.snapshot().status).toBe(AISphereStatus.Ready);
  expect(service.selection(model.name).model).toBe(model.name);
  expect(changed).toHaveBeenCalledTimes(1);
  const calls = fetcher.mock.calls.length;
  await vi.advanceTimersByTimeAsync(60000);
  expect(fetcher).toHaveBeenCalledTimes(calls);
});

test('recovery backs off, shares manual discovery, preserves removed models and stops on disposal', async () => {
  vi.useFakeTimers();
  const { service, store, fetcher, setModels } = setup();
  await service.initialize(store, 'http://127.0.0.1:1234');
  await service.connect('http://platform.test');
  fetcher
    .mockRejectedValueOnce(new Error('offline'))
    .mockRejectedValueOnce(new Error('still offline'));
  await expect(service.refresh()).rejects.toThrow(AISphereError.Unavailable);
  await vi.advanceTimersByTimeAsync(5000);
  expect(service.snapshot().status).toBe(AISphereStatus.Unavailable);
  const calls = fetcher.mock.calls.length;
  await vi.advanceTimersByTimeAsync(9999);
  expect(fetcher).toHaveBeenCalledTimes(calls);
  setModels([]);
  await Promise.all([service.refresh(), vi.advanceTimersByTimeAsync(1)]);
  expect(fetcher).toHaveBeenCalledTimes(calls + 2);
  expect(() => service.selection(model.name)).toThrow(AISphereError.MissingModel);
  fetcher.mockRejectedValueOnce(new Error('offline'));
  await expect(service.refresh()).rejects.toThrow();
  service.dispose();
  const disposedCalls = fetcher.mock.calls.length;
  await vi.advanceTimersByTimeAsync(120000);
  expect(fetcher).toHaveBeenCalledTimes(disposedCalls);
});

test('accepts HTTP and HTTPS origins, rejecting paths, credentials and query strings', () => {
  expect(normalizePlatformAddress(' https://127.0.0.1:123/ ')).toBe('https://127.0.0.1:123');
  expect(normalizePlatformAddress('http://example.test')).toBe('http://example.test');
  for (const address of [
    'file:///tmp/a',
    'https://user:pass@test',
    'https://test/v1',
    'https://test?key=x',
    'not a url',
  ]) {
    expect(() => normalizePlatformAddress(address)).toThrow(AISphereError.InvalidAddress);
  }
});

test('maps limits without treating zero as a zero allowance and rejects ambiguous catalogs', () => {
  const parsed = parsePlatformModels({ code: 0, model_list: [model] });
  expect(parsed[0]).toMatchObject({
    contextWindow: 262144,
    maxInput: undefined,
    maxTokens: undefined,
  });
  expect(() => parsePlatformModels({ code: 0, model_list: [model, model] })).toThrow();
  expect(() =>
    parsePlatformModels({ code: 0, model_list: [{ ...model, url: 'file:///tmp/model' }] }),
  ).toThrow();
  expect(() => parsePlatformModels({ code: 1, model_list: [model] })).toThrow();
});

test('starts closed and only exposes verified models, never their real key or endpoint', async () => {
  const { service, store, fetcher, values } = setup();
  await service.initialize(store, 'http://127.0.0.1:1234');
  expect(service.snapshot().status).toBe(AISphereStatus.Unconfigured);
  await expect(service.acquire(model.name)).rejects.toThrow();
  await service.connect('https://platform.test');
  expect(fetcher.mock.calls.map(call => call[0])).toEqual([
    'https://platform.test' + AISphere.VerifyPath,
    'https://platform.test' + AISphere.ModelsPath,
  ]);
  const visible = JSON.stringify([service.snapshot(), service.provider(), [...values.entries()]]);
  expect(visible).not.toContain('secret-a');
  expect(visible).not.toContain('inference.test');
  expect(service.project({ providers: { evil: {} } }).providers).toEqual({
    [AISphere.Provider]: service.provider(),
  });
});

test('invalid replacement preserves the previous binding and default model', async () => {
  const { service, store, fetcher, values } = setup();
  await service.initialize(store, 'http://127.0.0.1:1234');
  await service.connect('http://platform.test');
  fetcher.mockResolvedValueOnce(Response.json({ data: 'other' }));
  await expect(service.connect('http://other.test')).rejects.toThrow(AISphereError.InvalidPlatform);
  expect(values.get(AISphere.StoreKey)).toBe('http://platform.test');
  expect(service.snapshot().models[0].id).toBe(model.name);
});

test('directory refresh removes models and network failure cannot use old credentials', async () => {
  const { service, store, setModels, fetcher } = setup();
  await service.initialize(store, 'http://127.0.0.1:1234');
  await service.connect('http://platform.test');
  setModels([]);
  await service.refresh();
  await expect(service.acquire(model.name)).rejects.toThrow(AISphereError.MissingModel);
  fetcher.mockRejectedValue(new Error('offline'));
  await expect(service.refresh()).rejects.toThrow(AISphereError.Unavailable);
  expect(service.provider().models).toEqual([]);
  await expect(service.acquire(model.name)).rejects.toThrow();
});

test('active requests and tasks block rebinding, successful switches invalidate gateway credentials', async () => {
  const { service, store } = setup();
  await service.initialize(store, 'http://127.0.0.1:1234');
  await service.connect('http://platform.test');
  const acquired = await service.acquire(model.name);
  await expect(service.connect('http://other.test')).rejects.toThrow(AISphereError.Busy);
  acquired.release();
  service.busy = () => true;
  await expect(service.connect('http://other.test')).rejects.toThrow(AISphereError.Busy);
  // Same-address reconnect is allowed while tasks are running (refresh models).
  await expect(service.connect('http://platform.test')).resolves.toMatchObject({
    address: 'http://platform.test',
    status: AISphereStatus.Ready,
  });
  service.busy = () => false;
  const oldToken = service.token;
  await service.connect('http://other.test');
  expect(service.token).not.toBe(oldToken);
});

test('upgrades same-host http model URLs when the platform itself is https', async () => {
  const { service, store, setModels } = setup();
  setModels([
    {
      ...model,
      url: 'http://platform.test/v1-openai/chat/completions',
    },
    {
      ...model,
      name: 'other-host',
      url: 'http://inference.test/v1/chat/completions',
      api_key: 'secret-b',
    },
  ]);
  await service.initialize(store, 'http://127.0.0.1:1234');
  await service.connect('https://platform.test');
  const sameHost = await service.acquire(model.name);
  expect(sameHost.model.url).toBe('https://platform.test/v1-openai/chat/completions');
  sameHost.release();
  const otherHost = await service.acquire('other-host');
  expect(otherHost.model.url).toBe('http://inference.test/v1/chat/completions');
  otherHost.release();
});

test('IPC rejects direct external URLs and request methods outside the gateway contract', async () => {
  const { service, store } = setup();
  await service.initialize(store, 'http://127.0.0.1:1234');
  expect(() =>
    service.assertGateway('http://127.0.0.1:1234/v1/chat/completions', 'POST'),
  ).not.toThrow();
  for (const address of [
    'https://evil.test/v1/chat/completions',
    'http://127.0.0.1:1234/v1/models',
    'http://127.0.0.1:1234/v1/chat/completions?url=evil',
  ]) {
    expect(() => service.assertGateway(address, 'POST')).toThrow();
  }
});

test('parallel requests share a stale-directory refresh and cannot use removed models', async () => {
  const { service, store, fetcher, setModels } = setup();
  await service.initialize(store, 'http://127.0.0.1:1234');
  await service.connect('http://platform.test');
  const clock = Date.now();
  vi.spyOn(Date, 'now').mockReturnValue(clock + 31000);
  setModels([]);
  const results = await Promise.allSettled([
    service.acquire(model.name),
    service.acquire(model.name),
  ]);
  expect(results.every(result => result.status === 'rejected')).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(4);
});

test('refresh cannot race a replacement connection and same-address reconnect retains selection', async () => {
  const { service, store, fetcher, values } = setup();
  await service.initialize(store, 'http://127.0.0.1:1234');
  await service.connect('http://platform.test');
  let complete: (response: Response) => void = () => {};
  fetcher.mockImplementationOnce(
    () =>
      new Promise<Response>(resolve => {
        complete = resolve;
      }),
  );
  const pending = service.connect('http://other.test');
  await Promise.resolve();
  await expect(service.refresh()).rejects.toThrow(AISphereError.Busy);
  complete(Response.json({ data: 'ok' }));
  await pending;
  const current = values.get(AISphere.AppConfigKey) as { model: { defaultModel: string } };
  values.set(AISphere.AppConfigKey, {
    ...current,
    model: { ...current.model, defaultModel: 'removed-selection' },
  });
  await service.connect('http://other.test');
  expect((values.get(AISphere.AppConfigKey) as typeof current).model.defaultModel).toBe(
    'removed-selection',
  );
});
