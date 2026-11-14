import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import {
  resolveTargetArch,
  verifyNoRetiredRuntimeArtifacts,
  verifyPackagedLlamaCppBundled,
} from './verify-packaged-runtimes.cjs';

const directories: string[] = [];
const previousEdition = process.env.ZHIYUAN_UPDATE_VARIANT;
afterEach(() => {
  for (const root of directories.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  if (previousEdition === undefined) delete process.env.ZHIYUAN_UPDATE_VARIANT;
  else process.env.ZHIYUAN_UPDATE_VARIANT = previousEdition;
});
function fixture(relative: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'packaged-runtime-'));
  directories.push(root);
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'fixture');
  return {
    appOutDir: root,
    arch: 1,
    electronPlatformName: 'linux',
    packager: { projectDir: root, appInfo: { productFilename: 'ZhiYuan' } },
  };
}
test.each([
  'resources/openclaw/runtime',
  'resources/cfmind/runtime',
  'resources/channel-runtime/cc-connect-sidecar.exe',
  'resources/memory/engram.exe',
  'resources/windows-components/channel-runtime.7z',
  'resources/node_modules/@earendil-works/pi-coding-agent/dist/index.js',
])('rejects retired runtime artifact %s', relative => {
  expect(() => verifyNoRetiredRuntimeArtifacts(fixture(relative))).toThrow('retired runtime path');
});
test('retains Python, uv and Magpie resources and rejects unknown target architectures', () => {
  for (const relative of [
    'resources/python-win/python.exe',
    'resources/uv-win/uv.exe',
    'resources/magpie/magpie.exe',
  ])
    expect(() => verifyNoRetiredRuntimeArtifacts(fixture(relative))).not.toThrow();
  expect(() => resolveTargetArch({ arch: 99 })).toThrow('Unknown packaging arch');
});
test('lite packaging still rejects accidentally included local inference resources', () => {
  const context = fixture('resources/llamacpp-bundled/manifest.json');
  process.env.ZHIYUAN_UPDATE_VARIANT = 'lite';
  expect(() => verifyPackagedLlamaCppBundled(context)).toThrow(
    'Lite edition must not include packaged llamacpp-bundled',
  );
});
