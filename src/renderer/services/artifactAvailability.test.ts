// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';

import { CoworkArtifactSource } from '../../shared/cowork/artifacts';
import { ArtifactRole, type Artifact } from '../types/artifact';
import { prepareAvailableArtifacts } from './artifactAvailability';
import { detectArtifactsFromMessages } from './artifactParser';
import { CoworkMessageType } from '../../shared/cowork/constants';

afterEach(() => vi.unstubAllGlobals());

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

test('fails closed when the file check rejects', async () => {
  vi.stubGlobal('electron', {
    dialog: {
      checkArtifactFile: async () => {
        throw new Error('IPC failed');
      },
    },
  });
  expect(await prepareAvailableArtifacts([{ artifact, needsFileLoad: true }], true)).toEqual([]);
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
