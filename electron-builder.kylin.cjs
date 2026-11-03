'use strict';

const base = require('./electron-builder.json');

module.exports = {
  ...base,
  linux: {
    ...base.linux,
    target: ['rpm'],
    artifactName: 'ZhiYuanAgent-Kylin-V11-${version}-${arch}.${ext}',
    category: 'Utility',
    publish: [],
    desktop: {
      ...(base.linux.desktop || {}),
      entry: {
        ...(base.linux.desktop?.entry || {}),
        Name: '知远智能体',
        Comment: '知远 AI 智能体',
        Categories: 'Utility;Development;',
      },
    },
  },
  rpm: {
    ...(base.rpm || {}),
    packageCategory: 'Applications/System',
    priority: 'optional',
  },
};
