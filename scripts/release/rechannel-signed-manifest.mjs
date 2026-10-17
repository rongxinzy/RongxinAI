import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { readAndVerifyCollection } from './update-manifest-lib.mjs';

const [inputPath, outputPath, targetChannel] = process.argv.slice(2);
if (!inputPath || !outputPath || !targetChannel) {
  throw new Error(
    'usage: rechannel-signed-manifest.mjs <input-collection.json> <output-collection.json> <stable|beta>',
  );
}
if (targetChannel !== 'stable' && targetChannel !== 'beta') {
  throw new Error(`Unsupported target channel: ${targetChannel}`);
}

const keyId = process.env.UPDATE_MANIFEST_KEY_ID;
const privateKeyBase64 = process.env.UPDATE_MANIFEST_PRIVATE_KEY_BASE64;
if (!keyId || !privateKeyBase64) {
  throw new Error('UPDATE_MANIFEST_KEY_ID and UPDATE_MANIFEST_PRIVATE_KEY_BASE64 are required');
}

const privateKey = crypto.createPrivateKey({
  key: Buffer.from(privateKeyBase64, 'base64'),
  format: 'der',
  type: 'pkcs8',
});

const entries = await readAndVerifyCollection(inputPath);
const manifests = entries.map(({ envelope, payload }) => {
  if (payload.channel !== 'beta' && payload.channel !== 'stable') {
    throw new Error(`Unexpected source channel in manifest: ${payload.channel}`);
  }
  const nextPayload = { ...payload, channel: targetChannel };
  const payloadBytes = Buffer.from(JSON.stringify(nextPayload));
  return {
    schemaVersion: 1,
    keyId: envelope.keyId,
    algorithm: 'Ed25519',
    payload: payloadBytes.toString('base64url'),
    signature: crypto.sign(null, payloadBytes, privateKey).toString('base64url'),
  };
});

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify({ schemaVersion: 1, manifests }, null, 2)}\n`);
