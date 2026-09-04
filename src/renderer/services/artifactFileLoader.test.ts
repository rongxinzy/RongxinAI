import { beforeEach, expect, test, vi } from 'vitest';

import {
  clearArtifactFileCache,
  invalidateArtifactFile,
  loadArtifactDataUrl,
  loadArtifactFile,
} from './artifactFileLoader';

const TEXT_DATA_URL = 'data:text/plain;base64,SGVsbG8=';

beforeEach(() => {
  clearArtifactFileCache();
  vi.restoreAllMocks();
});

test('shares in-flight reads and reuses completed content', async () => {
  const readFileAsDataUrl = vi.fn().mockResolvedValue({ success: true, dataUrl: TEXT_DATA_URL });
  vi.stubGlobal('window', { electron: { dialog: { readFileAsDataUrl } } });

  const [first, second] = await Promise.all([
    loadArtifactDataUrl('C:\\workspace\\notes.txt'),
    loadArtifactDataUrl('C:/workspace/notes.txt'),
  ]);
  expect(first).toBe(TEXT_DATA_URL);
  expect(second).toBe(TEXT_DATA_URL);
  expect(readFileAsDataUrl).toHaveBeenCalledTimes(1);

  await loadArtifactDataUrl('C:/workspace/notes.txt');
  expect(readFileAsDataUrl).toHaveBeenCalledTimes(1);
});

test('decodes text artifacts through the same broker', async () => {
  const readFileAsDataUrl = vi.fn().mockResolvedValue({ success: true, dataUrl: TEXT_DATA_URL });
  vi.stubGlobal('window', { electron: { dialog: { readFileAsDataUrl } } });

  const loaded = await loadArtifactFile({
    id: 'artifact-1',
    messageId: 'message-1',
    sessionId: 'session-1',
    type: 'text',
    title: 'Notes',
    content: '',
    filePath: 'C:/workspace/notes.txt',
    source: 'tool',
    role: 'deliverable',
    createdAt: 1,
  });

  expect(loaded?.content).toBe('Hello');
  expect(readFileAsDataUrl).toHaveBeenCalledTimes(1);
});

test('invalidating a path forces a fresh read', async () => {
  const readFileAsDataUrl = vi
    .fn()
    .mockResolvedValueOnce({ success: true, dataUrl: TEXT_DATA_URL })
    .mockResolvedValueOnce({ success: true, dataUrl: 'data:text/plain;base64,V29ybGQ=' });
  vi.stubGlobal('window', { electron: { dialog: { readFileAsDataUrl } } });

  await loadArtifactDataUrl('C:/workspace/notes.txt');
  invalidateArtifactFile('C:\\workspace\\notes.txt');
  await expect(loadArtifactDataUrl('C:/workspace/notes.txt')).resolves.toContain('V29ybGQ');
  expect(readFileAsDataUrl).toHaveBeenCalledTimes(2);
});
