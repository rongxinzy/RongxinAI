// Enterprise product identity and resources. Signed packages use the shared
// Windows signing configuration on top of this overlay.

const fs = require('node:fs');
const path = require('node:path');

const { packagingExcludePatterns } = require('./scripts/packaging/assert-package-contents.cjs');
const baseConfig = require('./electron-builder.json');
const { enterpriseProduct } = require('./scripts/packaging/windows-product.cjs');

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
    ['**/*', ...packagingExcludePatterns()],
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
  // filename. The distinct appId separates the uninstall registry entries but
  // NOT the install directory: electron-builder derives the default directory
  // from the product name only when it is pure ASCII and otherwise falls back
  // to the package.json name, which this overlay shares with the community
  // build — so both products used to default into the same
  // %LocalAppData%\Programs\zhiyuan-agent and overwrite each other's files.
  // extraMetadata.name gives this build its own sanitizedName and therefore
  // its own default directory (Programs\zhiyuan-agent-enterprise).
  productName: enterpriseProduct.productName,
  executableName: enterpriseProduct.executableName,
  appId: enterpriseProduct.appId,
  extraMetadata: { ...(baseConfig.extraMetadata || {}), name: enterpriseProduct.packageName },
  // The community browser-login deep link belongs to the community build. The
  // enterprise build uses in-app password login and must not claim the scheme.
  protocols: [],
  extraResources: [...(baseConfig.extraResources || []), ...enterpriseResources],
};

module.exports = config;
