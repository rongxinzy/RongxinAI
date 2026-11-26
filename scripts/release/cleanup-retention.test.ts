import { expect, test } from 'vitest';
import { isDifferentialBaseObject } from './cleanup-retention.mjs';

const minimum = '2026.11.20-build.1';
const current = '2026.11.24-build.3';

test.each([
  `releases/${minimum}/win32-x64-cuda/ZhiYuan.exe.blockmap`,
  `releases/${current}/darwin-arm64-cpu/ZhiYuan.zip.blockmap`,
  'generations/2026.11.23-build.2/legacy/stable.json',
  `generations/${minimum}/electron/win32-x64-lite/latest.yml`,
])('preserves supported differential metadata %s after installer expiry', key => {
  expect(isDifferentialBaseObject(key, minimum, current)).toBe(true);
});

test.each([
  `releases/${minimum}/win32-x64-cuda/ZhiYuan.exe`,
  `releases/${minimum}/darwin-arm64-cpu/ZhiYuan.zip`,
  'releases/2026.11.18-build.2/win32-x64-cuda/ZhiYuan.exe.blockmap',
  'generations/2026.11.25-build.1/legacy/beta.json',
  'generations/not-a-version/legacy/stable.json',
  `builds/${current}/ZhiYuan.exe.blockmap`,
])('allows unrelated or unsupported metadata to expire: %s', key => {
  expect(isDifferentialBaseObject(key, minimum, current)).toBe(false);
});
