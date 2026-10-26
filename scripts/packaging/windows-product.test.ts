import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { enterpriseProduct, resolveWindowsProduct } = require('./windows-product.cjs');
const { productSource } = require('../installer-shell/generate-product.cjs');
const root = path.resolve(__dirname, '../..');

test('both installer engines use the electron-builder product and UUID namespace', () => {
  const community = resolveWindowsProduct(root, false);
  const enterprise = resolveWindowsProduct(root, true);
  expect(community.appGuid).toBe('331369f7-5ab3-5702-935d-f3cff6ba8163');
  expect(enterprise.appGuid).toBe('393416e6-6619-51b2-a514-db840f4ddb4e');
  expect(enterprise.appId).toBe(enterpriseProduct.appId);
  expect(enterprise.productName).toBe(enterpriseProduct.productName);
  expect(enterprise.executableName).toBe(`${enterpriseProduct.executableName}.exe`);
  expect(enterprise.installDirectoryName).not.toBe(community.installDirectoryName);
  for (const product of [community, enterprise]) {
    const source = productSource(product);
    expect(source).toContain(`AppGuid = "${product.appGuid}"`);
    expect(source).toContain(`AppExeName = "${product.executableName}"`);
    expect(product.installedFileName).toBe(`Uninstall ${product.productName}.exe`);
    expect(product.setupFileName).not.toBe(product.updaterFileName);
  }
});

test.each([false, true])(
  'CLI identity survives Windows code pages for enterprise=%s',
  enterprise => {
    const result = spawnSync(process.execPath, [path.join(__dirname, 'windows-product.cjs')], {
      env: { ...process.env, ZHIYUAN_ENTERPRISE_BUILD: enterprise ? '1' : '0' },
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).not.toMatch(/[^\x00-\x7f]/);
    expect(JSON.parse(result.stdout)).toEqual(resolveWindowsProduct(root, enterprise));
  },
);
