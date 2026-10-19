const path = require('node:path');
const { beforePack } = require('../electron-builder-hooks.cjs');

// Use the actual packaging hook so dependency health checks, filtering and
// component identities have a single owner. No app compilation/signing here.
process.env.ZHIYUAN_UPDATE_VARIANT = 'lite';
beforePack({
  electronPlatformName: 'win32',
  arch: 1,
  packager: {
    projectDir: path.resolve(__dirname, '../..'),
    config: structuredClone(require('../../electron-builder.json')),
  },
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
