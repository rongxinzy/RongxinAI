import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import { PiProviderTapeServer } from './piProviderTape';

async function fixture(listener: RequestListener) {
  const upstream = createServer(listener);
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const directory = await mkdtemp(path.join(tmpdir(), 'pi-tape-forward-'));
  const tapePath = path.join(directory, 'tape.jsonl');
  const tape = await PiProviderTapeServer.start({
    mode: 'record',
    scenario: 'forwarding',
    workDir: directory,
    tapePath,
    upstream: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`,
  });
  return {
    tape,
    tapePath,
    close: async () => {
      await tape.close();
      await new Promise<void>(resolve => {
        upstream.close(() => resolve());
        upstream.closeAllConnections();
      });
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test('forwards the first SSE chunk before upstream completion and records exact streamed bytes', async () => {
  let finish = () => {};
  const first = 'data: {"text":"你好"}\n\n';
  const last = 'data: [DONE]\n\n';
  const context = await fixture((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(first);
    finish = () => res.end(last);
  });
  try {
    const response = await fetch(`${context.tape.baseUrl}/chat/completions`);
    const reader = response.body!.getReader();
    const start = await reader.read();
    expect(Buffer.from(start.value!).toString('utf8')).toBe(first);
    expect(context.tape.totalEntries).toBe(0);
    finish();
    const chunks = [Buffer.from(start.value!)];
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      chunks.push(Buffer.from(chunk.value));
    }
    await vi.waitFor(() => expect(context.tape.totalEntries).toBe(1));
    const entry = JSON.parse((await readFile(context.tapePath, 'utf8')).trim().split('\n')[1]);
    expect(entry.responseBody).toBe(first + last);
    expect(Buffer.concat(chunks).toString('utf8')).toBe(first + last);
  } finally {
    finish();
    await context.close();
  }
});

test('client cancellation closes upstream and the recorder still serves the next request', async () => {
  const closed = vi.fn();
  const context = await fixture((req, res) => {
    if (req.url?.endsWith('/healthy')) return void res.end('healthy');
    res.on('close', closed);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: partial\n\n');
  });
  try {
    const controller = new AbortController();
    const response = await fetch(`${context.tape.baseUrl}/chat/completions`, {
      signal: controller.signal,
    });
    const reader = response.body!.getReader();
    await reader.read();
    controller.abort();
    await reader.read().catch(() => undefined);
    await vi.waitFor(() => expect(closed).toHaveBeenCalledOnce());
    expect(context.tape.totalEntries).toBe(0);
    expect(await (await fetch(`${context.tape.baseUrl}/healthy`)).text()).toBe('healthy');
    expect(context.tape.totalEntries).toBe(1);
  } finally {
    await context.close();
  }
});

test('cancels an upstream request still waiting for response headers', async () => {
  const closed = vi.fn();
  let entered = false;
  const context = await fixture((req, res) => {
    if (req.url?.endsWith('/healthy')) return void res.end('healthy');
    res.on('close', closed);
    entered = true;
  });
  try {
    const controller = new AbortController();
    const pending = fetch(`${context.tape.baseUrl}/chat/completions`, {
      signal: controller.signal,
    }).catch(error => error);
    await vi.waitFor(() => expect(entered).toBe(true));
    controller.abort();
    await pending;
    await vi.waitFor(() => expect(closed).toHaveBeenCalledOnce());
    expect(context.tape.totalEntries).toBe(0);
    expect(await (await fetch(`${context.tape.baseUrl}/healthy`)).text()).toBe('healthy');
  } finally {
    await context.close();
  }
});

test.each([false, true])(
  'handles an upstream reset with headers sent=%s without an unhandled rejection',
  async sent => {
    let reset = () => {};
    const context = await fixture((req, res) => {
      if (req.url?.endsWith('/healthy')) return void res.end('healthy');
      if (sent) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write('data: partial\n\n');
        reset = () => res.destroy();
      } else res.destroy();
    });
    try {
      const response = await fetch(`${context.tape.baseUrl}/chat/completions`);
      if (sent) {
        const reader = response.body!.getReader();
        await reader.read();
        reset();
        await expect(reader.read()).rejects.toThrow();
      } else {
        expect(response.status).toBe(502);
        expect(await response.json()).toEqual({ error: 'Tape upstream request failed.' });
      }
      expect(context.tape.totalEntries).toBe(0);
      expect(await (await fetch(`${context.tape.baseUrl}/healthy`)).text()).toBe('healthy');
    } finally {
      reset();
      await context.close();
    }
  },
);
