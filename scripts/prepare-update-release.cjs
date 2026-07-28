'use strict';

const fs = require('fs');
const path = require('path');

const keyId = process.env.UPDATE_MANIFEST_KEY_ID;
const publicKey = process.env.UPDATE_MANIFEST_PUBLIC_KEY_BASE64;
const output = path.join(__dirname, '..', 'src', 'shared', 'appUpdate', 'trustedKeys.ts');

if (!keyId && !publicKey) process.exit(0);
if (!keyId || !publicKey || !/^[A-Za-z0-9_-]+$/.test(keyId) || !/^[A-Za-z0-9+/]+={0,2}$/.test(publicKey)) {
  throw new Error('UPDATE_MANIFEST_KEY_ID and UPDATE_MANIFEST_PUBLIC_KEY_BASE64 must be valid for release builds');
}

fs.writeFileSync(
  output,
  `/** Generated before packaging. This file contains public release verification keys only. */\nexport const APP_UPDATE_TRUSTED_KEYS: Readonly<Record<string, string>> = {\n  ${JSON.stringify(keyId)}: ${JSON.stringify(publicKey)},\n};\n`,
);
