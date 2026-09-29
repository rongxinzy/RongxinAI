import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { expect, test } from 'vitest';

import { checkArtifactFile } from './artifactFileAvailability';

test('accepts a real file and rejects missing files, directories and invalid input', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'artifact-availability-'));
  const filePath = path.join(directory, 'report.pptx');
  try {
    await writeFile(filePath, 'test');
    expect(await checkArtifactFile(filePath)).toEqual({ success: true });
    expect(await checkArtifactFile(pathToFileURL(filePath).href)).toEqual({ success: true });
    expect(await checkArtifactFile(directory)).toEqual({ success: false });
    expect(await checkArtifactFile(path.join(directory, 'missing.pptx'))).toEqual({
      success: false,
    });
    expect(await checkArtifactFile('relative.pptx')).toEqual({ success: false });
    expect(await checkArtifactFile(null)).toEqual({ success: false });
    await rm(filePath);
    expect(await checkArtifactFile(filePath)).toEqual({ success: false });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
