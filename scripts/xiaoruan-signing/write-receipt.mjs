import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const SOURCE_REPO = 'rongxinzy/xiaoruan-ai-agent';
const SIGNING_REPO = 'rongxinzy/RongxinAI';
const RECEIPT_NAME = 'signing-receipt.json';
const RECEIPT_VERSION = 1;

function required(value, message) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(message);
  return text;
}

function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/**
 * Writes a receipt binding the signed installers in `releaseDir` to the
 * unsigned Xiaoruan build run they were produced for. The receipt ships inside
 * the signed-windows-build artifact so downstream upload tooling can verify
 * provenance and file integrity without trusting filenames.
 */
export function writeSigningReceipt(env = process.env, releaseDir = path.resolve('release')) {
  const sourceRunId = required(env.SOURCE_RUN_ID, 'SOURCE_RUN_ID is required.');
  if (!/^[1-9]\d{0,19}$/.test(sourceRunId)) {
    throw new Error('SOURCE_RUN_ID must be a positive Actions run ID.');
  }
  const sourceSha = required(env.SOURCE_SHA, 'SOURCE_SHA is required.');
  if (!/^[0-9a-f]{40}$/.test(sourceSha)) {
    throw new Error('SOURCE_SHA must be a 40-character commit SHA.');
  }
  const packageVersion = required(env.PACKAGE_VERSION, 'PACKAGE_VERSION is required.');
  const signingRunId = required(env.GITHUB_RUN_ID, 'GITHUB_RUN_ID is required.');

  const files = readdirSync(releaseDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.exe'))
    .map(entry => {
      const file = path.join(releaseDir, entry.name);
      return { name: entry.name, sha256: sha256File(file), size: statSync(file).size };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  if (files.length === 0) {
    throw new Error(`No signed installer found in ${releaseDir}.`);
  }

  const receipt = {
    version: RECEIPT_VERSION,
    sourceRepository: SOURCE_REPO,
    sourceRunId,
    sourceSha,
    packageVersion,
    signingRepository: SIGNING_REPO,
    signingRunId,
    files,
  };
  const receiptPath = path.join(releaseDir, RECEIPT_NAME);
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return { receipt, receiptPath };
}

function main() {
  const releaseDir = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve('release');
  const { receipt, receiptPath } = writeSigningReceipt(process.env, releaseDir);
  console.log(
    `Wrote ${receiptPath} for ${receipt.files.length} signed installer(s) ` +
      `bound to source run ${receipt.sourceRunId} (${receipt.sourceSha}).`,
  );
}

if (process.argv[1] && /write-receipt\.mjs$/.test(process.argv[1].replaceAll('\\', '/'))) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
