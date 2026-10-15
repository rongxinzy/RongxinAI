// Custom edition configuration for XiaoRuan AI Agent.
// Selecting the XiaoRuan variant is realized purely at the config level:
// `electron-builder --config electron-builder.xiaoruan.cjs`

const baseConfig = require('./electron-builder.json');

const config = {
  ...baseConfig,
  productName: '晓软AI智能体',
  executableName: '晓软AI智能体',
  appId: 'com.xiaoruan.app',
  protocols: [],
  win: {
    ...baseConfig.win,
    artifactName: '${productName}-${version}-${os}-${arch}.${ext}',
  },
  mac: {
    ...baseConfig.mac,
    artifactName: '${productName}-${version}-${os}-${arch}.${ext}',
  },
  linux: {
    ...baseConfig.linux,
    artifactName: '${productName}-${version}-${os}-${arch}.${ext}',
  },
};

module.exports = config;
