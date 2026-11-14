import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux';
import * as artifactWorkers from '../../workbenchTask/artifactWorkerPool';
import {
  buildDurableImageFixture,
  onePixelPng,
} from '../../workbenchTask/durableImage.testHarness';
import { DurableSession } from './durableSession.mjs';
import { DurableModelCatalog } from './durableModelCatalog.mjs';

let workerDirectory: string;
let pool: artifactWorkers.WorkbenchArtifactWorkerPool;
beforeAll(async () => {
  workerDirectory = await buildDurableImageFixture();
  pool = new artifactWorkers.WorkbenchArtifactWorkerPool(
    path.join(workerDirectory, 'artifactWorker.js'),
  );
}, 30_000);
afterAll(async () => {
  pool?.dispose();
  await fs.rm(workerDirectory, { recursive: true, force: true });
});

test('native read sends worker-processed image pixels into the next real model context', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'native-image-session-'));
  await fs.writeFile(path.join(directory, 'pixel.png'), onePixelPng);
  const prepare = vi
    .spyOn(artifactWorkers, 'prepareDurableImageAsync')
    .mockImplementation((bytes, mimeType, limits, signal) =>
      pool.prepareDurableImage({ bytes: Uint8Array.from(bytes).buffer, mimeType, limits }, signal),
    );
  const faux = fauxProvider({ models: [{ id: 'vision', input: ['text', 'image'] }] });
  const catalog = new DurableModelCatalog();
  catalog.models.setProvider(faux.provider);
  let receivedPixels = false;
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall('read', { path: 'pixel.png' }), { stopReason: 'toolUse' }),
    request => {
      const result = request.messages.findLast(message => message.role === 'toolResult');
      receivedPixels =
        result?.role === 'toolResult' &&
        result.content.some(
          block =>
            block.type === 'image' &&
            block.data === onePixelPng.toString('base64') &&
            block.mimeType === 'image/png',
        );
      return fauxAssistantMessage('The image is available.');
    },
  ]);
  let session: DurableSession | undefined;
  try {
    session = await DurableSession.open({
      cwd: directory,
      durableFile: path.join(directory, 'native.sqlite'),
      model: faux.getModel() as unknown as Record<string, unknown>,
      modelRuntime: catalog,
    });
    await session.prompt('Read pixel.png.');
    expect(prepare).toHaveBeenCalledOnce();
    expect(prepare.mock.calls[0][3]).toBeInstanceOf(AbortSignal);
    expect(receivedPixels).toBe(true);
  } finally {
    await session?.close();
    prepare.mockRestore();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
