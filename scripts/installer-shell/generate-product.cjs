'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { resolveWindowsProduct } = require('../packaging/windows-product.cjs');

function productSource(product) {
  const fields = {
    AppGuid: product.appGuid,
    AppExeName: product.executableName,
    DisplayName: product.productName,
    InstallDirectoryName: product.installDirectoryName,
  };
  return [
    '// Generated from the electron-builder product configuration. Do not edit.',
    'namespace ZhiYuan.Setup.Shell;',
    'internal static class InstallerProduct',
    '{',
    ...Object.entries(fields).map(
      ([key, value]) => `    public const string ${key} = ${JSON.stringify(value)};`,
    ),
    '}',
    '',
  ].join('\n');
}

if (require.main === module) {
  const output = process.argv[2];
  if (!output) throw new Error('Generated C# source output is required');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, productSource(resolveWindowsProduct(path.resolve(__dirname, '../..'))));
}

module.exports = { productSource };
