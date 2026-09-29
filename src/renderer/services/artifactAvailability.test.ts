// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';

import { CoworkArtifactSource } from '../../shared/cowork/artifacts';
import { CoworkMessageType } from '../../shared/cowork/constants';
import { ArtifactRole, type Artifact } from '../types/artifact';
import { ARTIFACT_FILE_PROBE_CONCURRENCY, prepareAvailableArtifacts } from './artifactAvailability';
import { detectArtifactsFromMessages } from './artifactParser';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const artifact: Artifact = {
  id: 'file',
  messageId: 'answer',
  sessionId: 'session',
  type: 'document',
  title: 'report.pptx',
  filePath: 'C:/workspace/report.pptx',
  content: '',
  source: CoworkArtifactSource.Tool,
  role: ArtifactRole.Deliverable,
  declared: true,
  createdAt: 1,
};

test('filters a nonexistent path claimed in the final model answer', async () => {
  const checkArtifactFile = vi.fn(async () => ({ success: false }));
  vi.stubGlobal('electron', { dialog: { checkArtifactFile } });
  const detected = detectArtifactsFromMessages(
    [
      {
        id: 'answer',
        type: CoworkMessageType.Assistant,
        content: 'Created C:/workspace/report.pptx',
        timestamp: 1,
        metadata: { isFinalAnswer: true },
      },
    ],
    'session',
  );
  expect(detected).toHaveLength(1);
  expect(await prepareAvailableArtifacts(detected, true)).toEqual([]);
  expect(checkArtifactFile).toHaveBeenCalledWith(artifact.filePath);
});

test('checks history too, keeps inline artifacts, and preserves asynchronous insertion order', async () => {
  const checkArtifactFile = vi.fn(async (filePath: string) => ({
    success: !filePath.includes('missing'),
  }));
  vi.stubGlobal('electron', { dialog: { checkArtifactFile } });
  const inline = { ...artifact, id: 'inline', filePath: undefined, content: '<html />' };
  const detected = [
    artifact,
    { ...artifact, id: 'missing', filePath: 'C:/missing.pptx' },
    inline,
  ].map(item => ({ artifact: item, needsFileLoad: Boolean(item.filePath) }));
  expect(
    (await prepareAvailableArtifacts(detected, false)).map(item => [item.artifact.id, item.reveal]),
  ).toEqual([
    ['file', false],
    ['inline', false],
  ]);
  expect(
    (await prepareAvailableArtifacts(detected, true)).map(item => [item.artifact.id, item.reveal]),
  ).toEqual([
    ['file', true],
    ['inline', true],
  ]);
});

test('keeps an artifact whose probe rejects instead of silently discarding it', async () => {
  vi.stubGlobal('electron', {
    dialog: {
      checkArtifactFile: async () => {
        throw new Error('IPC failed');
      },
    },
  });
  expect(await prepareAvailableArtifacts([{ artifact, needsFileLoad: true }], true)).toEqual([
    { artifact, reveal: false },
  ]);
});

test('keeps an artifact whose probe never answers, bounded by the probe deadline', async () => {
  vi.useFakeTimers();
  const checkArtifactFile = vi.fn(() => new Promise<{ success: boolean }>(() => {}));
  vi.stubGlobal('electron', { dialog: { checkArtifactFile } });

  const pending = prepareAvailableArtifacts([{ artifact, needsFileLoad: true }], true);
  await vi.advanceTimersByTimeAsync(60_000);

  expect(await pending).toEqual([{ artifact, reveal: false }]);
  expect(checkArtifactFile).toHaveBeenCalled();
});

test('bounds concurrent probes and preserves detection order', async () => {
  let inFlight = 0;
  let peak = 0;
  vi.stubGlobal('electron', {
    dialog: {
      checkArtifactFile: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await Promise.resolve();
        inFlight -= 1;
        return { success: true };
      },
    },
  });

  const detected = Array.from({ length: ARTIFACT_FILE_PROBE_CONCURRENCY * 3 }, (_, index) => ({
    artifact: { ...artifact, id: `artifact-${index}`, filePath: `C:/workspace/${index}.pptx` },
    needsFileLoad: true,
  }));

  const prepared = await prepareAvailableArtifacts(detected, false);

  expect(peak).toBe(ARTIFACT_FILE_PROBE_CONCURRENCY);
  expect(prepared.map(item => item.artifact.id)).toEqual(detected.map(item => item.artifact.id));
});

test('checks the decoded native path of a percent-encoded file URL claim', async () => {
  const checkArtifactFile = vi.fn(async () => ({ success: true }));
  vi.stubGlobal('electron', { dialog: { checkArtifactFile } });
  const urlArtifact = {
    ...artifact,
    id: 'url',
    filePath: 'file:///C:/workspace/report%20with%20spaces.pptx',
  };

  const prepared = await prepareAvailableArtifacts(
    [{ artifact: urlArtifact, needsFileLoad: true }],
    false,
  );

  expect(prepared).toHaveLength(1);
  expect(checkArtifactFile).toHaveBeenCalledWith('C:/workspace/report with spaces.pptx');
});

test('resolves a relative tool path against the session workspace before checking', async () => {
  const checkArtifactFile = vi.fn(async () => ({ success: true }));
  vi.stubGlobal('electron', { dialog: { checkArtifactFile } });
  const relative = { ...artifact, filePath: 'output/report.pptx' };
  expect(
    await prepareAvailableArtifacts(
      [{ artifact: relative, needsFileLoad: true }],
      false,
      'C:/workspace',
    ),
  ).toHaveLength(1);
  expect(checkArtifactFile).toHaveBeenCalledWith('C:/workspace/output/report.pptx');
});
