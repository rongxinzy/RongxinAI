import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, test } from 'vitest';

import { readPinnedManifest, sha256File } from './download-strata-runtime.cjs';

describe('download-strata-runtime pins', () => {
  test('package.json strata checksums match release-manifest template', () => {
    const pinned = readPinnedManifest();
    const template = JSON.parse(
      readFileSync(
        path.join(process.cwd(), 'resources/strata/release-manifest.template.json'),
        'utf8',
      ),
    );
    expect(pinned.releaseTag).toBe(template.strataReleaseTag);
    expect(pinned.control.sha256).toBe(template.control.sha256);
    expect(pinned.engineQwen.sha256).toBe(template.engineQwen.sha256);
    expect(pinned.engineDsv41.sha256).toBe(template.engineDsv41.sha256);
  });

  test('sha256File helper hashes deterministically', () => {
    const file = path.join(process.cwd(), 'resources/strata/release-manifest.template.json');
    expect(sha256File(file)).toMatch(/^[a-f0-9]{64}$/);
  });
});
