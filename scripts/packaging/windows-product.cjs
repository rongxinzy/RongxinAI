'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

// The extension overlay and the shared installer read the same product identity.
const enterpriseProduct = {
  productName: '知远企业版',
  executableName: '知远企业版',
  appId: 'com.zhiyuanagent.enterprise',
  packageName: 'zhiyuan-agent-enterprise',
};

function resolveWindowsProduct(root, enterprise = process.env.ZHIYUAN_ENTERPRISE_BUILD === '1') {
  const base = JSON.parse(fs.readFileSync(path.join(root, 'electron-builder.json'), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const config = enterprise ? { ...base, ...enterpriseProduct } : base;
  if (config.nsis.artifactName !== '${productName}-Setup-${version}.${ext}') {
    throw new Error('Unexpected Windows NSIS artifact configuration');
  }
  // RFC 9562 UUIDv5, using electron-builder's NSIS namespace. Keep the shell's
  // registry keys identical to the updater without another build dependency.
  const guidBytes = createHash('sha1')
    .update(Buffer.from('50e065bc313411e69bab38c9862bdaf3', 'hex'))
    .update(config.appId, 'utf8')
    .digest()
    .subarray(0, 16);
  guidBytes[6] = (guidBytes[6] & 0x0f) | 0x50;
  guidBytes[8] = (guidBytes[8] & 0x3f) | 0x80;
  const hex = guidBytes.toString('hex');
  const appGuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return {
    appId: config.appId,
    appGuid,
    productName: config.productName,
    executableName: `${config.executableName}.exe`,
    installDirectoryName: config.packageName || base.extraMetadata?.name || pkg.name,
    version: pkg.version,
    setupFileName: `ZhiYuanAgent-Setup-${pkg.version}.exe`,
    updaterFileName: `${config.productName}-Setup-${pkg.version}.exe`,
    sourceFileName: `${config.productName}-Setup-${pkg.version}.__uninstaller.exe`,
    installedFileName: `Uninstall ${config.productName}.exe`,
  };
}

if (require.main === module) {
  // PowerShell 5 decodes native stdout with the system code page. Keep the
  // transport ASCII so product names survive every runner's locale.
  process.stdout.write(
    JSON.stringify(resolveWindowsProduct(path.resolve(__dirname, '../..'))).replace(
      /[^\x00-\x7f]/g,
      character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
    ),
  );
}

module.exports = { enterpriseProduct, resolveWindowsProduct };
