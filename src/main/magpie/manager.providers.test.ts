import fs from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { setup } from './manager.testHarness';

describe('Magpie provider diagnostics and probing', () => {
  it('testProvider rejects a 200 HTML page instead of reporting the provider usable', async () => {
    const { manager, root } = await setup();
    try {
      await manager.start();
      const result = await manager.testProvider({
        name: 'New API',
        api: 'openai-completions',
        baseUrl: 'https://html.test/v1',
        models: ['glm-5.3-flash'],
      });
      expect(result).toMatchObject({ ok: false, errorCode: 'html-endpoint' });
    } finally {
      await manager.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('testProvider rejects a non-JSON 200 body', async () => {
    const { manager, root } = await setup();
    try {
      await manager.start();
      const result = await manager.testProvider({
        name: 'Plain',
        api: 'openai-completions',
        baseUrl: 'https://plain.test/v1',
        models: ['m1'],
      });
      expect(result).toMatchObject({ ok: false, errorCode: 'not-json' });
    } finally {
      await manager.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('testProvider reports a body over the cap as too large, never as success or JSON error', async () => {
    const { manager, root } = await setup();
    try {
      await manager.start();
      const result = await manager.testProvider({
        name: 'Big',
        api: 'openai-completions',
        baseUrl: 'https://big.test/v1',
        models: ['m1'],
      });
      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe('too-large');
      expect(result.errorCode).not.toBe('not-json');
      expect(result.discoveredModels).toBeUndefined();
    } finally {
      await manager.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('testProvider treats a body that fills the cap with more bytes left as truncated', async () => {
    const { manager, root } = await setup();
    try {
      await manager.start();
      const result = await manager.testProvider({
        name: 'Split',
        api: 'openai-completions',
        baseUrl: 'https://splitbig.test/v1',
        models: ['m1'],
      });
      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe('too-large');
      expect(result.errorCode).not.toBe('not-json');
      expect(result.discoveredModels).toBeUndefined();
    } finally {
      await manager.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('testProvider rejects a 200 JSON error body instead of calling it usable', async () => {
    const { manager, root } = await setup();
    try {
      await manager.start();
      const result = await manager.testProvider({
        name: 'JSON Error',
        api: 'openai-completions',
        baseUrl: 'https://jsonerror.test/v1',
        models: ['m1'],
      });
      expect(result).toMatchObject({ ok: false, errorCode: 'api-error' });
      expect(result.error).toContain('invalid key');
    } finally {
      await manager.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('testProvider parses a BOM-prefixed JSON body', async () => {
    const { manager, root } = await setup();
    try {
      await manager.start();
      const result = await manager.testProvider({
        name: 'BOM',
        api: 'openai-completions',
        baseUrl: 'https://bom.test/v1',
        models: ['m1'],
      });
      expect(result).toMatchObject({ ok: true, discoveredModels: ['m1'] });
    } finally {
      await manager.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('saves declared context windows and clears the matching cached error', async () => {
    const { manager, root, fetcher } = await setup();
    try {
      await manager.start();
      manager.recordError(
        'My OpenAI: answered 200 OK with a web page (text/html), not an API reply',
      );
      await manager.saveProvider({
        id: 'custom-openai',
        name: 'My OpenAI',
        api: 'openai-completions',
        baseUrl: 'https://api.openai.com/v1',
        models: ['gpt-4o'],
        contexts: { '*': 65536, 'gpt-4o': 131072 },
      });
      const saveCall = fetcher.mock.calls.find(([url]) => url.endsWith('/api/provider/save'));
      const body = JSON.parse(saveCall![1]?.body as string);
      expect(body.contexts).toEqual({ '*': 65536, 'gpt-4o': 131072 });
      expect((await manager.diagnostics()).recentErrors).toEqual([]);
    } finally {
      await manager.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('omits contexts on a save that does not say, so upstream keeps them', async () => {
    const { manager, root, fetcher } = await setup();
    try {
      await manager.start();
      await manager.saveProvider({
        id: 'custom-openai',
        name: 'My OpenAI',
        api: 'openai-completions',
        baseUrl: 'https://api.openai.com/v1',
        models: ['gpt-4o'],
      });
      const saveCall = fetcher.mock.calls.find(([url]) => url.endsWith('/api/provider/save'));
      const body = JSON.parse(saveCall![1]?.body as string);
      expect(body).not.toHaveProperty('contexts');
    } finally {
      await manager.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('clears a provider error stored as truncated JSON, and keeps another provider error', async () => {
    const { manager, root } = await setup();
    try {
      await manager.start();
      manager.recordError(
        '"message":"公司: request (618356 tokens) exceeds the available context size","param":null',
      );
      manager.recordError(
        JSON.stringify({
          message: '公司: answered 200 OK with a web page (text/html), not an API reply',
          param: null,
        }),
      );
      manager.recordError('Other: boom', 'other-provider');
      await manager.saveProvider({
        id: 'custom-openai',
        name: '公司',
        api: 'openai-completions',
        baseUrl: 'https://api.openai.com/v1',
        models: ['gpt-4o'],
        contexts: { '*': 65536 },
      });
      const errors = (await manager.diagnostics()).recentErrors ?? [];
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toBe('Other: boom');
    } finally {
      await manager.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('clears a truncated JSON error when the provider is toggled, and keeps another provider', async () => {
    const { manager, root } = await setup();
    const truncated =
      '"message":"My OpenAI: request (618356 tokens) exceeds the available context size","param":null';
    try {
      await manager.start();
      manager.recordError(truncated);
      manager.recordError('Other: boom', 'other-provider');
      await manager.setProviderEnabled('custom-openai', false);
      let errors = (await manager.diagnostics()).recentErrors ?? [];
      expect(errors.map(error => error.message)).toEqual(['Other: boom']);

      manager.recordError(truncated);
      await manager.setProviderEnabled('custom-openai', true);
      errors = (await manager.diagnostics()).recentErrors ?? [];
      expect(errors.map(error => error.message)).toEqual(['Other: boom']);
    } finally {
      await manager.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('deletes a provider when the name lookup fails', async () => {
    const { manager, root, fetcher } = await setup();
    const originalFetch = fetcher.getMockImplementation();
    let failNextProviderList = false;
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
      if (failNextProviderList && url.endsWith('/api/providers')) {
        failNextProviderList = false;
        return new Response('down', { status: 500 });
      }
      return originalFetch ? await originalFetch(url, init) : Response.json({});
    });
    try {
      await manager.start();
      failNextProviderList = true;
      await expect(manager.deleteProvider('custom-openai')).resolves.toBeDefined();
      expect(
        fetcher.mock.calls.some(([url, init]) => {
          if (!url.endsWith('/api/provider/delete') || init?.method !== 'POST') return false;
          const body = JSON.parse(String(init.body ?? '{}')) as { id?: string };
          return body.id === 'custom-openai';
        }),
      ).toBe(true);
    } finally {
      await manager.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('rejects an illegal context window before starting the service', async () => {
    const { manager, root, spawn } = await setup();
    try {
      await expect(
        manager.saveProvider({
          name: 'Relay',
          api: 'openai-completions',
          baseUrl: 'https://relay.test/v1',
          models: ['m1'],
          contexts: { '*': 0 },
        }),
      ).rejects.toThrow('context window');
      expect(spawn).not.toHaveBeenCalled();
    } finally {
      await manager.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('keeps the provider error when a save changes only the key', async () => {
    const { manager, root } = await setup();
    try {
      await manager.start();
      manager.recordError('{"message":"My OpenAI: boom","param":null}');
      await manager.saveProvider({
        id: 'custom-openai',
        name: 'My OpenAI',
        api: 'openai-completions',
        baseUrl: 'https://api.openai.com/v1',
        models: ['gpt-4o'],
        key: 'sk-new',
      });
      expect((await manager.diagnostics()).recentErrors).toHaveLength(1);
    } finally {
      await manager.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('clears a provider error recorded as String(error) with an Error prefix', async () => {
    const { manager, root } = await setup();
    try {
      await manager.start();
      manager.recordError('Error: My OpenAI: boom');
      await manager.saveProvider({
        id: 'custom-openai',
        name: 'My OpenAI',
        api: 'openai-completions',
        baseUrl: 'https://api.openai.com/v2',
        models: ['gpt-4o'],
      });
      expect((await manager.diagnostics()).recentErrors).toEqual([]);
    } finally {
      await manager.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

});
