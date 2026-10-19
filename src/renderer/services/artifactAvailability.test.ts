// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';

import { CoworkArtifactSource } from '../../shared/cowork/artifacts';
import { ArtifactRole, type Artifact } from '../types/artifact';
import {
  ArtifactFileAvailability,
  openAvailableArtifact,
  probeArtifactFileAvailability,
} from './artifactAvailability';
import { i18nService } from './i18n';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

test('reports a recorded path that no longer exists as missing', async () => {
  const checkArtifactFile = vi.fn(async () => ({ success: false }));
  vi.stubGlobal('electron', { dialog: { checkArtifactFile } });

  expect(await probeArtifactFileAvailability(artifact)).toBe(ArtifactFileAvailability.Missing);
  expect(checkArtifactFile).toHaveBeenCalledWith(artifact.filePath);
});

test('treats inline artifacts without a path as available without probing', async () => {
  const checkArtifactFile = vi.fn(async () => ({ success: false }));
  vi.stubGlobal('electron', { dialog: { checkArtifactFile } });
  const inline = { ...artifact, filePath: undefined, content: '<html />' };

  expect(await probeArtifactFileAvailability(inline)).toBe(ArtifactFileAvailability.Available);
  expect(checkArtifactFile).not.toHaveBeenCalled();
});

test('a rejected probe is unknown, never missing', async () => {
  vi.stubGlobal('electron', {
    dialog: {
      checkArtifactFile: async () => {
        throw new Error('IPC failed');
      },
    },
  });
  expect(await probeArtifactFileAvailability(artifact)).toBe(ArtifactFileAvailability.Unavailable);
});

test('a probe that never answers is bounded by the probe deadline', async () => {
  vi.useFakeTimers();
  const checkArtifactFile = vi.fn(() => new Promise<{ success: boolean }>(() => {}));
  vi.stubGlobal('electron', { dialog: { checkArtifactFile } });

  const pending = probeArtifactFileAvailability(artifact);
  await vi.advanceTimersByTimeAsync(60_000);

  expect(await pending).toBe(ArtifactFileAvailability.Unavailable);
  expect(checkArtifactFile).toHaveBeenCalled();
});

test('checks the decoded native path of a percent-encoded file URL claim', async () => {
  const checkArtifactFile = vi.fn(async () => ({ success: true }));
  vi.stubGlobal('electron', { dialog: { checkArtifactFile } });
  const urlArtifact = { ...artifact, filePath: 'file:///C:/workspace/report%20with%20spaces.pptx' };

  expect(await probeArtifactFileAvailability(urlArtifact)).toBe(ArtifactFileAvailability.Available);
  expect(checkArtifactFile).toHaveBeenCalledWith('C:/workspace/report with spaces.pptx');
});

test('resolves a relative tool path against the session workspace before checking', async () => {
  const checkArtifactFile = vi.fn(async () => ({ success: true }));
  vi.stubGlobal('electron', { dialog: { checkArtifactFile } });
  const relative = { ...artifact, filePath: 'output/report.pptx' };
  expect(await probeArtifactFileAvailability(relative, 'C:/workspace')).toBe(
    ArtifactFileAvailability.Available,
  );
  expect(checkArtifactFile).toHaveBeenCalledWith('C:/workspace/output/report.pptx');
});

test('a missing artifact dispatches an error toast instead of opening it', async () => {
  const checkArtifactFile = vi.fn(async () => ({ success: false }));
  vi.stubGlobal('electron', { dialog: { checkArtifactFile } });
  const dispatch = vi.spyOn(window, 'dispatchEvent');
  const open = vi.fn();

  await openAvailableArtifact(artifact, open);

  const toast = dispatch.mock.calls.at(-1)?.[0] as CustomEvent | undefined;
  expect(toast?.type).toBe('app:showToast');
  expect(toast?.detail).toMatchObject({
    message: i18nService.t('fileNotFound'),
    isError: true,
  });
  expect(open).not.toHaveBeenCalled();
});

test('an available artifact opens without dispatching a toast', async () => {
  const checkArtifactFile = vi.fn(async () => ({ success: true }));
  vi.stubGlobal('electron', { dialog: { checkArtifactFile } });
  const dispatch = vi.spyOn(window, 'dispatchEvent');
  const open = vi.fn();

  await openAvailableArtifact(artifact, open);

  expect(open).toHaveBeenCalledTimes(1);
  expect(dispatch.mock.calls.some(([event]) => event.type === 'app:showToast')).toBe(false);
});
