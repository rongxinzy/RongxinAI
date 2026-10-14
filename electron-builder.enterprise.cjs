// Enterprise Windows package configuration: electron-builder.json plus the
// Zhiyuan enterprise plugin overlay. The community flow never loads this file;
// selecting the enterprise variant is realized purely at the config level
// (`electron-builder --config electron-builder.enterprise.cjs`).
//
// When CERTUM_CERT_THUMBPRINT is present (injected by the release environment
// after the setup-certum-signing action connects SimplySign), electron-builder
// signs the packaged executables and the NSIS installer in a single pass;
// re-signing the installer afterwards would leave the inner executables
// unsigned. Without it the overlay stays unsigned so local `--dir` builds keep
// working. The certificate private key never leaves the Certum cloud HSM.

const fs = require('node:fs');
const path = require('node:path');

const baseConfig = require('./electron-builder.json');

// electron-builder resolves extraResources "from" against the project
// directory, so inputs stay repo-root-relative (the same convention the
// workflow uses for its env overrides).
function enterpriseResource(envName, defaultFrom, to, filter) {
  const from = process.env[envName] || defaultFrom;
  if (!fs.existsSync(path.resolve(__dirname, from))) {
    throw new Error(
      `Enterprise package input is missing: ${from}. ` +
        `Build it first (for example bun run build:enterprise) or set ${envName} to override the path.`,
    );
  }
  const resource = { from, to };
  if (filter) resource.filter = filter;
  return resource;
}

// No admin console directory is bundled on purpose: the packaged admin bundle
// had zero runtime consumers in the host, and the Admin Console remains a
// web-deployed app in the zhiyuanAaaS repository.
const enterpriseResources = [
  enterpriseResource(
    'ZHIYUAN_ENTERPRISE_EXTENSION_BUNDLE',
    'enterprise/dist/extension.cjs',
    'zhiyuan-enterprise/extension.cjs',
  ),
  enterpriseResource(
    'ZHIYUAN_ENTERPRISE_RENDERER_DIRECTORY',
    'enterprise/dist/ui',
    'zhiyuan-enterprise/ui',
    ['**/*', '!**/*.map'],
  ),
  enterpriseResource(
    'ZHIYUAN_ENTERPRISE_NOTICE_FILE',
    'enterprise/THIRD_PARTY_NOTICES.md',
    'zhiyuan-enterprise/THIRD_PARTY_NOTICES.md',
  ),
  enterpriseResource(
    'ZHIYUAN_ENTERPRISE_CONFIG_FILE',
    'resources/zhiyuan-enterprise/config.json',
    'zhiyuan-enterprise/config.json',
  ),
];

const config = {
  ...baseConfig,
  // Enterprise packages must be distinguishable from the public Zhiyuan build
  // in Windows Explorer, the Start menu, the taskbar, and the installer
  // filename. A distinct appId keeps both products fully isolated: otherwise
  // the NSIS installer treats the community install as the same product.
  productName: '知远企业版',
  executableName: '知远企业版',
  appId: 'com.zhiyuanagent.enterprise',
  // The community browser-login deep link belongs to the community build. The
  // enterprise build uses in-app password login and must not claim the scheme.
  protocols: [],
  extraResources: [...(baseConfig.extraResources || []), ...enterpriseResources],
  win: { ...baseConfig.win },
};

const certificateThumbprint = (process.env.CERTUM_CERT_THUMBPRINT || '')
  .replace(/[^0-9a-f]/gi, '')
  .toUpperCase();

if (certificateThumbprint) {
  if (!/^[0-9A-F]{40}$/.test(certificateThumbprint)) {
    throw new Error(
      'CERTUM_CERT_THUMBPRINT must contain the 40-character SHA-1 thumbprint of the Certum ' +
        'code-signing certificate. It is injected by the release environment after the ' +
        'setup-certum-signing action connects SimplySign.',
    );
  }
  config.win.signtoolOptions = {
    certificateSha1: certificateThumbprint,
    signingHashAlgorithms: ['sha256'],
    rfc3161TimeStampServer: 'http://time.certum.pl',
  };
}

module.exports = config;
