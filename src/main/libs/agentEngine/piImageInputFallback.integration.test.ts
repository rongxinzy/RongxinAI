/**
 * Temporary end-to-end check (not committed): real Pi SDK + real HTTP provider.
 *
 * The fake provider mirrors the 172.18.x gateway: a request carrying an image
 * block is rejected with the vision-encoder 400, text-only requests answer
 * normally. That reproduces the reported scenario exactly — "configured as
 * image-capable, server cannot read images".
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';

import type { CoworkStore } from '../../coworkStore';

const VISION_400 =
  '{"message":"this server was started without the vision encoder (run setup again and choose \'vision\'), so it cannot read images","type":"invalid_request_error","param":"","code":null}';

const requests: Array<{ hasImage: boolean; body: string }> = [];

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', chunk => {
    raw += chunk;
  });
  req.on('end', () => {
    const hasImage = raw.includes('"type":"image"') || raw.includes('"image_url"');
    requests.push({ hasImage, body: raw });
    if (hasImage) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(VISION_400);
      return;
    }
    if (raw.includes('"stream":true')) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const chunk = (delta: unknown, finish: string | null) =>
        `data: ${JSON.stringify({
          id: 'chatcmpl-e2e',
          object: 'chat.completion.chunk',
          created: 0,
          model: 'GLM-5.3-Flash',
          choices: [{ index: 0, delta, finish_reason: finish }],
        })}\n\n`;
      res.write(chunk({ role: 'assistant', content: '我读不了图片，请把内容贴成文字。' }, null));
      res.write(chunk({}, 'stop'));
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'chatcmpl-e2e',
        object: 'chat.completion',
        created: 0,
        model: 'GLM-5.3-Flash',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: '我读不了图片，请把内容贴成文字。' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
  });
});

let port = 0;
const imageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-image-fallback-'));

/** Real 2x2 PNG so the adapter can read the bytes back from the path. */
const png = (() => {
  const zlib = require('node:zlib');
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };
  const raw = Buffer.concat([
    Buffer.from([0, 255, 0, 0, 255, 0, 0]),
    Buffer.from([0, 255, 0, 0, 255, 0, 0]),
  ]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
})();

const writeImage = (name: string): string => {
  const filePath = path.join(imageDir, name);
  fs.writeFileSync(filePath, png);
  return filePath;
};

vi.mock('../../workbenchTask/artifactWorkerPool', async () => {
  const { runTextWorkerOperation, collectWorkbenchArtifacts } =
    await import('../../workbenchTask/textWorkerOperations');
  return {
    collectWorkbenchArtifactsAsync: async (
      input: Parameters<typeof collectWorkbenchArtifacts>[0],
    ) => collectWorkbenchArtifacts(input),
    transformCoworkTextAsync: async (input: Parameters<typeof runTextWorkerOperation>[0]) =>
      runTextWorkerOperation(input),
  };
});

vi.mock('./piOpenAICompatProxy', () => ({
  registerPiOpenAICompatTokenRefresher: vi.fn(),
  // The adapter routes OpenAI-protocol providers through this "proxy" URL; point
  // it at the fake gateway so the real SDK performs real HTTP against it.
  registerPiOpenAICompatUpstream: vi.fn(async () => `http://127.0.0.1:${port}/v1`),
}));

vi.mock('../../communityAuthSession', () => ({
  getModelPoolAccessToken: vi.fn(async () => ''),
}));

vi.mock('../coworkUtil', async importOriginal => {
  const actual = await importOriginal<typeof import('../coworkUtil')>();
  return {
    ...actual,
    applyApplicationRuntimeEnv: vi.fn(),
    resolveGitBashPathForPi: vi.fn(() => undefined),
  };
});

vi.mock('../claudeSettings', () => {
  const providerMetadata = {
    providerName: 'custom_0',
    modelName: 'GLM-5.3-Flash',
    supportsImage: true,
    capabilities: {
      toolCalling: 'supported',
      imageInput: 'supported',
      videoInput: 'unknown',
      audioInput: 'unknown',
      documentInput: 'unknown',
      reasoning: 'supported',
    },
  };
  const config = () => ({
    apiKey: 'sk-e2e',
    baseURL: `http://127.0.0.1:${port}/v1`,
    model: 'GLM-5.3-Flash',
    apiType: 'openai' as const,
  });
  return {
    resolveRawApiConfig: () => ({ config: config(), providerMetadata }),
    resolveRawApiConfigForModelRef: () => ({ config: config(), providerMetadata }),
  };
});

import { resolveBundledOcrHelper } from '../ocrHelper';
import { PiRuntimeAdapter } from './piRuntimeAdapter';

const fakeStore = {
  addMessage: (sessionId: string, message: object) => ({ id: `m-${sessionId}`, ...message }),
  updateMessage: () => undefined,
  updateSession: () => undefined,
  getSession: () => undefined,
  refreshSessionArtifacts: () => undefined,
} as unknown as CoworkStore; // test double for a wide store interface

const readRecord = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;

beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  port = typeof address === 'object' && address ? address.port : 0;
});

afterAll(() => {
  server.close();
  fs.rmSync(imageDir, { recursive: true, force: true });
});

test('image rejection is retried as text and reported to the user', async () => {
  const messages: unknown[] = [];
  const errors: unknown[] = [];
  const adapter = new PiRuntimeAdapter();
  adapter.on('message', (_sessionId, message) => messages.push(message));
  adapter.on('error', (_sessionId, error) => errors.push(error));
  adapter.setCoworkStore(fakeStore);

  const attachmentPath = writeImage('hash.png');
  await adapter.startSession('e2e-image-rejection', '图里面的内容是', {
    imageAttachments: [{ name: 'image-1791.png', mimeType: 'image/png', path: attachmentPath }],
  });

  await vi.waitFor(
    () => {
      expect(requests.filter(request => request.hasImage).length).toBeGreaterThanOrEqual(1);
      expect(requests.filter(request => !request.hasImage).length).toBeGreaterThanOrEqual(1);
    },
    { timeout: 30000 },
  );

  const textOnly = requests.find(request => !request.hasImage);
  expect(textOnly?.body).toContain('hash.png'); // the model receives the file path
  // ...together with the extraction path: the bundled helper's command where the
  // helper resolves (Windows), the self-written guidance otherwise.
  expect(textOnly?.body).toContain(
    resolveBundledOcrHelper() ? 'ocr-image.ps1' : 'ask the user to paste',
  );
  expect(errors).toHaveLength(0); // no dead-end error bubble
  const notices = messages.filter(
    message =>
      readRecord(message, 'type') === 'system' &&
      String(readRecord(message, 'content')).includes('纯文本重试'),
  );
  expect(notices).toHaveLength(1);
}, 60000);

test('a second image turn on the same model no longer sends the bytes', async () => {
  requests.length = 0;
  const adapter = new PiRuntimeAdapter();
  adapter.setCoworkStore(fakeStore);
  adapter.on('error', () => undefined);

  await adapter.startSession('e2e-image-suppressed', '再看一张', {
    imageAttachments: [
      { name: 'image-1792.png', mimeType: 'image/png', path: writeImage('hash2.png') },
    ],
  });
  await vi.waitFor(() => expect(requests.length).toBeGreaterThanOrEqual(1), { timeout: 20000 });

  expect(requests.every(request => !request.hasImage)).toBe(true);
  expect(requests[0].body).toContain('hash2.png');
}, 60000);
