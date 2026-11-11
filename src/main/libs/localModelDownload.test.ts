import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vitest';
import { downloadLocalModelFile, sha256File } from './localModelDownload';
import { sha256FileStream } from './fileHasher';

vi.mock('./fileHasher', () => ({ sha256FileStream: vi.fn() }));

const directories: string[] = [];
const bytes = Buffer.from([0x47, 0x47, 0x55, 0x46, 3, 0, 0, 0]);
const checksum = createHash('sha256').update(bytes).digest('hex');

function target(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'model-download-lifecycle-'));
  directories.push(directory);
  return path.join(directory, 'model.gguf');
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  directories
    .splice(0)
    .forEach(directory => fs.rmSync(directory, { recursive: true, force: true }));
});

test('cancellation preserves every reported byte and resumes from that exact offset', async () => {
  const destination = target();
  const controller = new AbortController();
  const progressBytes: Buffer[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(bytes.subarray(0, 4), {
          headers: { 'content-length': '8' },
        }),
    ),
  );

  await expect(
    downloadLocalModelFile(
      'https://download.test/model.gguf',
      destination,
      completed => {
        if (completed === 4) {
          progressBytes.push(
            fs.existsSync(destination + '.download')
              ? fs.readFileSync(destination + '.download')
              : Buffer.alloc(0),
          );
          controller.abort();
        }
      },
      controller.signal,
      checksum,
      8,
    ),
  ).rejects.toThrow('Install cancelled');

  expect(progressBytes).toEqual([bytes.subarray(0, 4)]);
  expect(fs.readFileSync(destination + '.download')).toEqual(bytes.subarray(0, 4));
  const fetchMock = vi.fn(async (_url: string, options: RequestInit) => {
    expect(options.headers).toEqual({ Range: 'bytes=4-' });
    return new Response(bytes.subarray(4), {
      status: 206,
      headers: { 'content-length': '4', 'content-range': 'bytes 4-7/8' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  await downloadLocalModelFile(
    'https://download.test/model.gguf',
    destination,
    () => {},
    undefined,
    checksum,
    8,
  );
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(fs.readFileSync(destination)).toEqual(bytes);
  expect(fs.existsSync(destination + '.download')).toBe(false);
});

test('a server ignoring Range replaces the partial file instead of appending', async () => {
  const destination = target();
  fs.writeFileSync(destination + '.download', bytes.subarray(0, 4));
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(bytes, {
          headers: { 'content-length': '8' },
        }),
    ),
  );
  await downloadLocalModelFile(
    'https://download.test/model.gguf',
    destination,
    () => {},
    undefined,
    checksum,
    8,
  );
  expect(fs.readFileSync(destination)).toEqual(bytes);
});

test('cancelling a stalled body closes the destination before rejection', async () => {
  const destination = target();
  const controller = new AbortController();
  const open = fs.promises.open.bind(fs.promises);
  let closed = false;
  let didRead!: () => void;
  const reading = new Promise<void>(resolve => {
    didRead = resolve;
  });
  vi.spyOn(fs.promises, 'open').mockImplementation(async (...args) => {
    const handle = await open(...args);
    const close = handle.close.bind(handle);
    vi.spyOn(handle, 'close').mockImplementation(async () => {
      await close();
      closed = true;
    });
    return handle;
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          new ReadableStream(
            {
              pull() {
                didRead();
              },
            },
            { highWaterMark: 0 },
          ),
        ),
    ),
  );
  const download = downloadLocalModelFile(
    'https://download.test/model.gguf',
    destination,
    () => {},
    controller.signal,
  );
  const rejected = expect(download).rejects.toThrow('Install cancelled');
  await reading;
  controller.abort();
  await rejected;
  expect(closed).toBe(true);
});

test('write errors close the destination and do not report unwritten bytes', async () => {
  const destination = target();
  const open = fs.promises.open.bind(fs.promises);
  let closed = false;
  vi.spyOn(fs.promises, 'open').mockImplementation(async (...args) => {
    const handle = await open(...args);
    const close = handle.close.bind(handle);
    vi.spyOn(handle, 'writeFile').mockRejectedValue(new Error('disk full'));
    vi.spyOn(handle, 'close').mockImplementation(async () => {
      await close();
      closed = true;
    });
    return handle;
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(bytes)),
  );
  const progress = vi.fn();
  await expect(
    downloadLocalModelFile('https://download.test/model.gguf', destination, progress),
  ).rejects.toThrow('disk full');
  expect(closed).toBe(true);
  expect(progress).not.toHaveBeenCalled();
});

test('an already cancelled download does not fetch or open a file', async () => {
  const destination = target();
  const controller = new AbortController();
  controller.abort();
  const fetchMock = vi.fn();
  const open = vi.spyOn(fs.promises, 'open');
  vi.stubGlobal('fetch', fetchMock);
  await expect(
    downloadLocalModelFile(
      'https://download.test/model.gguf',
      destination,
      () => {},
      controller.signal,
    ),
  ).rejects.toThrow('Install cancelled');
  expect(fetchMock).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
});

test('large model hashes retain the streaming worker path and cancellation signal', async () => {
  const destination = target();
  const signal = new AbortController().signal;
  const size = 513 * 1024 * 1024;
  vi.spyOn(fs.promises, 'stat').mockResolvedValue({ size } as fs.Stats);
  vi.mocked(sha256FileStream).mockResolvedValue(checksum);
  await expect(sha256File(destination, signal)).resolves.toBe(checksum);
  expect(sha256FileStream).toHaveBeenCalledWith(destination, {
    signal,
    maxBytes: size,
    timeoutMs: 60 * 60_000,
  });
});

test('opening failure cancels the response body', async () => {
  const destination = target();
  const cancel = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            cancel,
          }),
        ),
    ),
  );
  vi.spyOn(fs.promises, 'open').mockRejectedValue(new Error('permission denied'));
  await expect(
    downloadLocalModelFile('https://download.test/model.gguf', destination, () => {}),
  ).rejects.toThrow('permission denied');
  expect(cancel).toHaveBeenCalledOnce();
});

test('abort during a write waits for completion before closing the handle', async () => {
  const destination = target();
  const controller = new AbortController();
  const open = fs.promises.open.bind(fs.promises);
  const events: string[] = [];
  let didWrite!: () => void;
  const writing = new Promise<void>(resolve => {
    didWrite = resolve;
  });
  let finishWrite!: () => void;
  const release = new Promise<void>(resolve => {
    finishWrite = resolve;
  });
  vi.spyOn(fs.promises, 'open').mockImplementation(async (...args) => {
    const handle = await open(...args);
    const write = handle.writeFile.bind(handle);
    const close = handle.close.bind(handle);
    vi.spyOn(handle, 'writeFile').mockImplementation(async (...writeArgs) => {
      events.push('writing');
      didWrite();
      await release;
      await write(...writeArgs);
      events.push('written');
    });
    vi.spyOn(handle, 'close').mockImplementation(async () => {
      await close();
      events.push('closed');
    });
    return handle;
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(bytes.subarray(0, 4))),
  );
  const download = downloadLocalModelFile(
    'https://download.test/model.gguf',
    destination,
    () => {},
    controller.signal,
  );
  const rejected = expect(download).rejects.toThrow('Install cancelled');
  await writing;
  controller.abort();
  expect(events).toEqual(['writing']);
  finishWrite();
  await rejected;
  expect(events).toEqual(['writing', 'written', 'closed']);
  expect(fs.readFileSync(destination + '.download')).toEqual(bytes.subarray(0, 4));
});
