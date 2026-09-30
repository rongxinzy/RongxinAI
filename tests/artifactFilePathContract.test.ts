import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterAll, beforeAll, expect, test } from 'vitest';

import { checkArtifactFile } from '../src/main/artifactFileAvailability';
import { resolveArtifactPath } from '../src/shared/cowork/artifactPath';

/**
 * The renderer gate and the main process reader must agree on the file a
 * declared path points at. Names with spaces, non-ASCII characters and
 * URL-significant characters are exactly the cases where renderer-side
 * `file:///` slicing used to hand the main process an unreadable path.
 */
const FILE_NAMES = [
  'report with spaces.pptx',
  '报告 空格.pptx',
  '50%.pptx',
  'a#b.pptx',
  'plain.pptx',
];

let workspace = '';

beforeAll(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), 'artifact-file-path-'));
  for (const name of FILE_NAMES) {
    await writeFile(path.join(workspace, name), 'x');
  }
});

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

test('reads files claimed as file URLs', async () => {
  for (const name of FILE_NAMES) {
    const fileUrl = pathToFileURL(path.join(workspace, name)).href;
    expect(await checkArtifactFile(resolveArtifactPath(fileUrl))).toEqual({ success: true });
  }
});

test('reads files claimed as relative workspace paths', async () => {
  const cwd = workspace.replace(/\\/g, '/');
  for (const name of FILE_NAMES) {
    expect(await checkArtifactFile(resolveArtifactPath(name, cwd))).toEqual({ success: true });
  }
});

test('still rejects a claim whose file does not exist', async () => {
  const missing = pathToFileURL(path.join(workspace, 'gone.pptx')).href;
  expect(await checkArtifactFile(resolveArtifactPath(missing))).toEqual({ success: false });
});
