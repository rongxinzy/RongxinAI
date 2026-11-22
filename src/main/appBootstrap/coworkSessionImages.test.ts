import { existsSync, mkdtempSync, promises as fs, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as nextImmediate } from 'node:timers/promises';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import {
  deleteCoworkSessionImages,
  persistCoworkImageAttachments,
} from '../coworkImageAttachments';
import {
  createCoworkStoreHarness,
  insertMessageRow,
  insertSessionRow,
} from '../coworkStore/coworkStore.testHarness';
import { scheduleBackgroundMaterialize } from './coworkSessionImages';
import { lifecycleRuntime } from './lifecycleRuntimeState';
import { getCoworkImageRoot } from './workspacePaths';

let userData: string;
let harness: ReturnType<typeof createCoworkStoreHarness>;
vi.mock('electron', () => ({ app: { getPath: () => userData } }));
vi.mock('./runtimeServices', () => ({ getCoworkStore: () => harness.store }));
vi.mock('./sessionServices', () => ({}));
vi.mock('../workbenchTask/artifactWorkerPool', () => ({
  decodeCoworkImageAsync: async (value: string) => {
    const decoded = Buffer.from(value, 'base64');
    return {
      bytes: Uint8Array.from(decoded).buffer,
      hash: createHash('sha256').update(decoded).digest('hex').slice(0, 32),
    };
  },
}));

const sessionId = 'session-1';
const messageId = 'message-1';
const bytes = Buffer.from('image bytes');
const image = { name: 'shot.png', mimeType: 'image/png', base64Data: bytes.toString('base64') };

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'cowork-materialize-'));
  harness = createCoworkStoreHarness();
  insertSessionRow(harness.db, sessionId);
  insertMessageRow(
    harness.db,
    messageId,
    sessionId,
    'user',
    'See attached',
    JSON.stringify({
      imageAttachments: [image],
    }),
    1,
  );
});

afterEach(() => {
  lifecycleRuntime.isQuitting = false;
  harness.db.close();
  rmSync(userData, { recursive: true, force: true });
});

test('deletion and scheduled materialization leave a replacement session directory intact', async () => {
  const { store } = harness;
  const root = getCoworkImageRoot();
  const [existing] = await persistCoworkImageAttachments(root, sessionId, [image]);
  expect(existsSync(existing.path)).toBe(true);
  scheduleBackgroundMaterialize(sessionId, store.messages.getSessionMessages(sessionId));

  store.deleteSessions([sessionId]);
  const release = Promise.withResolvers<void>();
  const rm = fs.rm;
  const remove = vi.spyOn(fs, 'rm').mockImplementationOnce(async (path, options) => {
    await release.promise;
    await rm(path, options);
  });
  const deletion = deleteCoworkSessionImages(root, sessionId);
  try {
    expect(existsSync(join(root, sessionId))).toBe(false);
    store.createSession('Replacement', userData, '', 'local', [], 'main', '', 'work', sessionId);
    const [replacement] = await persistCoworkImageAttachments(root, sessionId, [
      { ...image, base64Data: Buffer.from('new image').toString('base64') },
    ]);
    await nextImmediate();
    await nextImmediate();
    release.resolve();
    await deletion;

    expect(existsSync(existing.path)).toBe(false);
    expect(readFileSync(replacement.path, 'utf8')).toBe('new image');
  } finally {
    release.resolve();
    await deletion;
    remove.mockRestore();
  }
});

test('scheduled image materialization persists images for a session that still exists', async () => {
  const { store } = harness;
  scheduleBackgroundMaterialize(sessionId, store.messages.getSessionMessages(sessionId));
  await vi.waitFor(() => {
    const [saved] =
      store.messages.getMessage(sessionId, messageId)?.metadata?.imageAttachments ?? [];
    expect(saved).toEqual({ name: image.name, mimeType: image.mimeType, path: expect.any(String) });
    expect(readFileSync(saved.path)).toEqual(bytes);
  });
});

test('scheduled image materialization yields to app shutdown', async () => {
  const { store } = harness;
  scheduleBackgroundMaterialize(sessionId, store.messages.getSessionMessages(sessionId));
  lifecycleRuntime.isQuitting = true;
  await nextImmediate();

  expect(existsSync(join(getCoworkImageRoot(), sessionId))).toBe(false);
  expect(store.messages.getMessage(sessionId, messageId)?.metadata?.imageAttachments).toEqual([
    image,
  ]);
});
