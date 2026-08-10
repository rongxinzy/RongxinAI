'use strict';

/**
 * If APP_BUILD_VERSION is set, patches the top-level "version" field in
 * package.json to that value right before electron-builder runs. This
 * handles cases where intermediate build steps (OpenClaw runtime etc.)
 * restore the original version.
 *
 * Only the first "version" field is replaced; nested fields inside
 * "openclaw", "llamacpp", etc. are left unchanged.
 */
const fs = require('fs');
const path = require('path');

const version = process.env.APP_BUILD_VERSION;
const variant = process.env.ZHIYUAN_UPDATE_VARIANT;
if (!version && !variant) process.exit(0);

const pkgPath = path.join(__dirname, '..', 'package.json');
let content = fs.readFileSync(pkgPath, 'utf8');

// Replace only the first top-level "version" field.
if (version) content = content.replace(/("version"\s*:\s*)"[^"]+"/, `$1"${version}"`);

if (variant) {
  if (/"zhiyuanUpdateVariant"\s*:/.test(content)) {
    content = content.replace(/("zhiyuanUpdateVariant"\s*:\s*)"[^"]+"/, `$1"${variant}"`);
  } else {
    content = content.replace(
      /("version"\s*:\s*"[^"]+",\n)/,
      `$1  "zhiyuanUpdateVariant": "${variant}",\n`,
    );
  }
}
fs.writeFileSync(pkgPath, content, 'utf8');

console.log(
  `[ensure-build-version] Patched version=${version || 'unchanged'}, variant=${variant || 'unchanged'}`,
);
