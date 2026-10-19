import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { copyRuntimeTree } = require('./prepare-inference-edition-runtime.cjs') as {
  copyRuntimeTree: (sourceRoot: string, targetRoot: string) => void;
};

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('copyRuntimeTree', () => {
  test.skipIf(process.platform === 'win32')(
    'keeps shared-library symlinks relative so they stay inside the app bundle',
    () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bundled-runtime-'));
      roots.push(root);
      const binDir = path.join(root, 'vendor', 'backends', 'b9244', 'mac-arm64', 'bin');
      fs.mkdirSync(binDir, { recursive: true });
      fs.writeFileSync(path.join(binDir, 'libllama.0.0.9244.dylib'), 'lib');
      fs.symlinkSync('libllama.0.0.9244.dylib', path.join(binDir, 'libllama.0.dylib'));
      fs.symlinkSync('libllama.0.dylib', path.join(binDir, 'libllama.dylib'));

      const target = path.join(root, 'resources', 'llamacpp-bundled');
      copyRuntimeTree(path.join(root, 'vendor'), target);

      const stagedBin = path.join(target, 'backends', 'b9244', 'mac-arm64', 'bin');
      expect(fs.readlinkSync(path.join(stagedBin, 'libllama.0.dylib'))).toBe(
        'libllama.0.0.9244.dylib',
      );
      expect(fs.readlinkSync(path.join(stagedBin, 'libllama.dylib'))).toBe('libllama.0.dylib');
      fs.rmSync(path.join(root, 'vendor'), { recursive: true });
      expect(fs.readFileSync(path.join(stagedBin, 'libllama.dylib'), 'utf8')).toBe('lib');
    },
  );
});
