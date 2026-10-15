import { buildSync } from 'esbuild';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { expect, test, vi } from 'vitest';

import type * as Transport from './visibleApiTransport';

test.each([
  { mode: 'development', dev: true },
  { mode: 'production', dev: false },
  { mode: 'test', dev: true },
])(
  'routes $mode requests uniformly through main process IPC without Node globals',
  async ({ mode, dev }) => {
    const output = buildSync({
      entryPoints: [resolve('src/renderer/services/visibleApiTransport.ts')],
      bundle: true,
      write: false,
      platform: 'browser',
      format: 'iife',
      globalName: 'transport',
      define: {
        'import.meta.env.MODE': JSON.stringify(mode),
        'import.meta.env.DEV': JSON.stringify(dev),
      },
    });
    const ipcFetch = vi.fn().mockResolvedValue({ ok: true });
    const pageRequest = vi.fn().mockImplementation(async () => new Response('hello'));
    const context = {
      window: { electron: { api: { fetch: ipcFetch } } },
      fetch: pageRequest,
      AbortController,
      TextDecoder,
      console: { debug: vi.fn() },
    };
    const transport = runInNewContext(
      `${output.outputFiles[0].text}\ntransport;`,
      context,
    ) as typeof Transport;
    expect(transport.shouldExposeApiInDevtoolsNetwork()).toBe(false);
    const request = { url: 'https://example.invalid/chat', method: 'POST', headers: {} };
    expect((await transport.apiFetch(request)).ok).toBe(true);
    expect(pageRequest).toHaveBeenCalledTimes(0);
    expect(ipcFetch).toHaveBeenCalledTimes(1);
  },
);
