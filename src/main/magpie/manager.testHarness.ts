import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { vi } from 'vitest';
import { projectMagpieCatalog } from './catalog';
import { MAGPIE_VERSION } from './integrity';
import { MagpieManager, type MagpieManagerOptions } from './manager';

export async function temporary() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'magpie-host-test-'));
}

export async function setup(
  serviceEnabled?: { read(): boolean; write(enabled: boolean): void },
  gatewayPort?: { read(): number | undefined; write(port: number): void },
  lanAccess?: { read(): { enabled: boolean; lanToken: string | null } },
  options?: {
    agents?: unknown[];
    onReapply?: (agentId: string) => Promise<void> | void;
    failReapply?: string[];
    failAgentsTimes?: number;
    managerOptions?: Partial<MagpieManagerOptions>;
  },
) {
  const root = await temporary();
  let port = 21000;
  const child = Object.assign(new EventEmitter(), {
    exitCode: null as number | null,
    signalCode: null as string | null,
    kill: vi.fn(function () {
      child.exitCode = 0;
      queueMicrotask(() => child.emit('exit', 0));
      return true;
    }),
  });
  const spawn = vi.fn(() => child);
  const callerKeys: Array<{ id: string; name: string; secret?: string }> = [];
  const fetcher = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.endsWith('/api/hello'))
      return Response.json({ name: 'magpie', version: MAGPIE_VERSION });
    if (url.endsWith('/api/caller-keys'))
      return Response.json({
        keys: callerKeys.map(({ secret: _secret, ...rest }) => rest),
      });
    if (url.endsWith('/api/caller-keys/copy-key')) {
      const body = JSON.parse(String(_init?.body ?? '{}')) as { key?: string };
      const key = callerKeys.find(entry => entry.id === body.key);
      return Response.json({ keys: [], secret: key?.secret ?? '' });
    }
    if (url.endsWith('/api/caller-keys/add-key')) {
      const body = JSON.parse(String(_init?.body ?? '{}')) as {
        name?: string;
        secret?: string;
      };
      callerKeys.push({
        id: `lan-${callerKeys.length + 1}`,
        name: body.name,
        secret: body.secret,
      });
      return Response.json({ keys: [] });
    }
    if (url.endsWith('/api/caller-keys/remove-key')) {
      const body = JSON.parse(String(_init?.body ?? '{}')) as { key?: string };
      const index = callerKeys.findIndex(entry => entry.id === body.key);
      if (index >= 0) callerKeys.splice(index, 1);
      return Response.json({ keys: [] });
    }
    if (url.endsWith('/api/state') && (options?.failAgentsTimes ?? 0) > 0) {
      options!.failAgentsTimes! -= 1;
      return new Response('warming up', { status: 500 });
    }
    if (url.endsWith('/api/state'))
      return Response.json({
        settings: { secret: 'never-project' },
        agents: options?.agents ?? [
          {
            id: 'codex',
            name: 'Codex',
            wired: true,
            fields: [
              {
                key: 'model',
                label: 'Model',
                value: 'm1',
                options: [{ value: 'm2', label: 'Model two', token: 'secret' }],
              },
              { key: 'apiKey', label: 'Key', value: 'secret' },
            ],
          },
        ],
      });
    if (url.endsWith('/api/agents/cli'))
      return Response.json({
        agents: { codex: { version: '1', path: '/secret/path' } },
        pending: false,
      });
    if (url.includes('html.test'))
      return new Response('<!doctype html><html><title>New API</title></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    if (url.includes('plain.test'))
      return new Response('hello', { status: 200, headers: { 'content-type': 'text/plain' } });
    if (url.includes('://big.test'))
      return new Response(`{"data":[${' '.repeat(256 * 1024 + 10)}`, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    if (url.includes('splitbig.test')) {
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(' '.repeat(256 * 1024)));
          controller.enqueue(encoder.encode('x'));
          controller.close();
        },
      });
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.includes('bom.test'))
      return new Response('\uFEFF{"data":[{"id":"m1"}]}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    if (url.includes('jsonerror.test')) return Response.json({ error: { message: 'invalid key' } });
    if (url.endsWith('/v1/models'))
      return Response.json({ data: [{ id: 'm1', owned_by: 'test', key: 'secret' }] });
    if (url.endsWith('/api/providers'))
      return Response.json({
        providers: [
          {
            id: 'zhiyuan-host-enterprise',
            name: 'Enterprise Host',
            chat: 'http://127.0.0.1:8000',
            key: 'magpie-local',
            models: ['ent-1'],
            off: false,
          },
          {
            id: 'custom-openai',
            name: 'My OpenAI',
            chat: 'https://api.openai.com/v1',
            key: { set: true, masked: 'sk-…6789' },
            models: [
              { id: 'gpt-4o', on: true },
              { id: 'gpt-4o-mini', on: false },
            ],
            off: false,
          },
        ],
      });
    if (url.endsWith('/api/provider/key')) {
      const body = JSON.parse(String(_init?.body ?? '{}')) as { id?: string };
      if (body.id === 'custom-openai') return Response.json({ key: 'sk-secret123456789' });
      return Response.json({ key: '' });
    }
    if (url.includes('api.openai.com') && url.endsWith('/models')) {
      const headers = _init?.headers as Record<string, string> | undefined;
      if (headers?.Authorization === 'Bearer sk-secret123456789') {
        return Response.json({ data: [{ id: 'gpt-4o' }] });
      }
      return new Response('Unauthorized', { status: 401 });
    }
    if (
      url.endsWith('/api/provider/save') ||
      url.endsWith('/api/provider/on') ||
      url.endsWith('/api/provider/off')
    )
      return Response.json({ ok: true });
    if (url.includes('/api/agents/reapply/')) {
      const agentId = decodeURIComponent(url.split('/api/agents/reapply/')[1] ?? '');
      if (options?.failReapply?.includes(agentId))
        return new Response('reapply failed', { status: 500 });
      await options?.onReapply?.(agentId);
      return Response.json({ ok: true });
    }
    return Response.json({});
  });
  const manager = new MagpieManager({
    serviceEnabled,
    ...(lanAccess ? { lanAccess } : {}),
    parseCatalog: async bytes => projectMagpieCatalog(JSON.parse(new TextDecoder().decode(bytes))),
    resourcesRoot: root,
    privateHome: root,
    environment: { HOME: root, USERPROFILE: root },
    verify: async () => '/fake/magpie',
    spawn: spawn as never,
    fetch: fetcher as never,
    port: async () => ++port,
    ...(gatewayPort ? { gatewayPort } : {}),
    ...options?.managerOptions,
  });
  return { root, child, spawn, fetcher, manager, callerKeys };
}
