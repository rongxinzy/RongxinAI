'use strict';

const defense = require('./electron-builder.defense.cjs');
const kylin = require('./electron-builder.kylin.cjs');

module.exports = {
  ...defense,
  directories: { ...defense.directories, output: 'release/defense-kylin' },
  linux: {
    ...kylin.linux,
    artifactName: 'ZhiYuanAgentDefense-Kylin-V11-${version}-${arch}.${ext}',
    extraResources: [],
    desktop: {
      ...kylin.linux.desktop,
      entry: {
        ...kylin.linux.desktop.entry,
        Name: defense.productName,
        Comment: defense.productName,
      },
    },
  },
  rpm: kylin.rpm,
};
