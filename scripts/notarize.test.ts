import path from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import notarizeModule, { looksLikeStapleFailure, stapleWithRetry } from './notarize.js';

const notarizing = notarizeModule as unknown as (
  context: unknown,
  deps?: Record<string, unknown>,
) => Promise<void>;

const appOutDir = path.join(path.sep, 'tmp', 'release');
const appPath = path.join(appOutDir, '知远智能体.app');

const context = {
  electronPlatformName: 'darwin',
  appOutDir,
  packager: { appInfo: { productFilename: '知远智能体' } },
};

const STAPLE_ERROR = 'The staple and validate action failed! Error 68.';
const CLOUDKIT_ERROR =
  'Error Domain=NSURLErrorDomain Code=-1005 "The network connection was lost." Domain is api.apple-cloudkit.com';

beforeEach(() => {
  vi.stubEnv('APPLE_ID', 'dev@example.com');
  vi.stubEnv('APPLE_APP_SPECIFIC_PASSWORD', 'secret');
  vi.stubEnv('APPLE_TEAM_ID', 'TEAM123');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

test('非 darwin 平台与缺少凭据时都不触发公证', async () => {
  const notarizeApp = vi.fn();
  await notarizing({ ...context, electronPlatformName: 'linux' }, { notarize: notarizeApp });
  expect(notarizeApp).not.toHaveBeenCalled();

  vi.stubEnv('APPLE_ID', '');
  await notarizing(context, { notarize: notarizeApp });
  expect(notarizeApp).not.toHaveBeenCalled();
});

test('looksLikeStapleFailure 只认票据/网络类失败', () => {
  // Apple 票据服务的偶发故障（CI 里最常见的那两种措辞）
  expect(looksLikeStapleFailure(STAPLE_ERROR)).toBe(true);
  expect(looksLikeStapleFailure(CLOUDKIT_ERROR)).toBe(true);
  // 提交/凭据问题不是 staple 问题：必须原样抛出，不能掩盖
  expect(looksLikeStapleFailure('HTTP 401 Unauthorized: invalid credentials')).toBe(false);
  expect(
    looksLikeStapleFailure('Notarization failed: the app is not signed with a valid certificate'),
  ).toBe(false);
});

test('提交失败时原样抛出，不尝试 staple', async () => {
  const submitError = new Error('HTTP 401 Unauthorized: invalid credentials');
  const staple = vi.fn();

  await expect(
    notarizing(context, { notarize: async () => Promise.reject(submitError), staple }),
  ).rejects.toBe(submitError);
  expect(staple).not.toHaveBeenCalled();
});

test('仅 staple 失败时直接补 staple，不重新提交公证', async () => {
  const staple = vi.fn(async () => undefined);
  let notarizeCalls = 0;

  await notarizing(context, {
    notarize: async () => {
      notarizeCalls += 1;
      throw new Error(STAPLE_ERROR);
    },
    staple,
  });

  expect(notarizeCalls).toBe(1);
  expect(staple).toHaveBeenCalledTimes(1);
  expect(staple).toHaveBeenCalledWith(appPath);
});

test('stapleWithRetry 首次成功只调用一次 stapler', async () => {
  const run = vi.fn();
  await stapleWithRetry(appPath, { run, wait: async () => undefined });
  expect(run).toHaveBeenCalledTimes(1);
});

test('stapleWithRetry 对偶发失败退避重试后成功', async () => {
  const run = vi
    .fn()
    .mockImplementationOnce(() => {
      throw new Error(CLOUDKIT_ERROR);
    })
    .mockImplementationOnce(() => undefined);
  const wait = vi.fn(async () => undefined);

  await stapleWithRetry(appPath, { run, wait });

  expect(run).toHaveBeenCalledTimes(2);
  expect(wait).toHaveBeenCalledTimes(1);
  expect(wait).toHaveBeenCalledWith(5_000);
});

test('stapleWithRetry 用尽重试后仍然失败（不放宽发布标准）', async () => {
  const run = vi.fn(() => {
    throw new Error(CLOUDKIT_ERROR);
  });
  const wait = vi.fn(async () => undefined);

  await expect(stapleWithRetry(appPath, { run, wait })).rejects.toThrow(CLOUDKIT_ERROR);
  expect(run).toHaveBeenCalledTimes(5);
  expect(wait.mock.calls.map(call => call[0])).toEqual([5_000, 10_000, 20_000, 30_000]);
});

test('模块导出支持 CommonJS 与 ESM 调用', () => {
  const raw = require('./notarize.js');
  expect(typeof raw).toBe('function');
  expect(raw.default).toBe(raw);
  expect(raw.afterSign).toBe(raw);
  expect(typeof raw.looksLikeStapleFailure).toBe('function');
  expect(typeof raw.stapleWithRetry).toBe('function');
});
