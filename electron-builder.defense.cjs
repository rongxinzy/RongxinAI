'use strict';

const baseConfig = require('./electron-builder.json');
const {
  defenseAppId,
  defenseProductName,
  defensePackageName,
  excludedDefenseEntries,
} = require('./scripts/packaging/defense-edition.cjs');

const certificateThumbprint = (process.env.CERTUM_CERT_THUMBPRINT || '')
  .replace(/[^0-9a-f]/gi, '')
  .toUpperCase();
if (certificateThumbprint && !/^[0-9A-F]{40}$/.test(certificateThumbprint)) {
  throw new Error('CERTUM_CERT_THUMBPRINT must contain a 40-character SHA-1 thumbprint.');
}

module.exports = {
  ...baseConfig,
  appId: defenseAppId,
  productName: defenseProductName,
  executableName: 'ZhiYuanAgentDefense',
  directories: { ...baseConfig.directories, output: 'release/defense' },
  extraMetadata: {
    ...baseConfig.extraMetadata,
    name: defensePackageName,
    productName: defenseProductName,
  },
  files: baseConfig.files.map(entry => {
    if (typeof entry === 'string' || !excludedDefenseEntries[entry.from]) return entry;
    return {
      ...entry,
      filter: [
        ...entry.filter,
        ...excludedDefenseEntries[entry.from].map(filename => `!${filename}`),
      ],
    };
  }),
  extraResources: [
    ...baseConfig.extraResources.filter(
      resource =>
        !['acp/registry.json', 'llamacpp-bundled', 'magpie/upstream.json'].includes(resource.to),
    ),
    { from: 'LICENSE', to: 'LICENSE.txt' },
  ],
  protocols: [],
  publish: null,
  mac: { ...baseConfig.mac, publish: null },
  linux: { ...baseConfig.linux, publish: null },
  win: {
    ...baseConfig.win,
    publish: null,
    ...(certificateThumbprint && {
      signtoolOptions: {
        certificateSha1: certificateThumbprint,
        signingHashAlgorithms: ['sha256'],
        rfc3161TimeStampServer: 'http://time.certum.pl',
      },
    }),
  },
  nsis: {
    ...baseConfig.nsis,
    perMachine: true,
    allowToChangeInstallationDirectory: false,
    runAfterFinish: false,
    include: 'scripts/nsis-installer.defense.nsh',
    license: 'build/installer-assets/license.txt',
    artifactName: 'ZhiYuanAgentDefense-Setup-${version}.${ext}',
  },
  forceCodeSigning: Boolean(certificateThumbprint),
};
