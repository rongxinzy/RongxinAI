import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const releaseDirectory = path.resolve(
  process.env.ZHIYUAN_RELEASE_DIR ?? path.join(repositoryRoot, 'release'),
);
const checksumFile = path.join(releaseDirectory, 'SHA256SUMS.txt');

const entries = await fs.readdir(releaseDirectory, { withFileTypes: true });
const installers = entries
  .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.exe'))
  .map(entry => entry.name)
  .sort();
assert.ok(installers.length > 0, `No Windows installer found in ${releaseDirectory}.`);

const checksumText = await fs.readFile(checksumFile, 'utf8');
const checksumEntries = parseChecksumFile(checksumText);
assert.equal(
  checksumEntries.size,
  installers.length,
  'SHA256SUMS.txt must contain exactly one entry per Windows installer.',
);

const verified = [];
for (const installer of installers) {
  const expected = checksumEntries.get(installer);
  assert.ok(expected, `SHA256SUMS.txt is missing ${installer}.`);
  const content = await fs.readFile(path.join(releaseDirectory, installer));
  const actual = crypto.createHash('sha256').update(content).digest('hex');
  assert.equal(actual, expected, `SHA256 mismatch for ${installer}.`);
  verified.push({ name: installer, bytes: content.byteLength, sha256: actual });
}

console.log(
  JSON.stringify(
    { status: 'passed', releaseDirectory, checksumFile, installers: verified },
    null,
    2,
  ),
);

function parseChecksumFile(value) {
  const result = new Map();
  for (const line of value
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)) {
    const match = line.match(/^([a-f0-9]{64})\s{2}(.+\.exe)$/i);
    assert.ok(match, `Invalid SHA256SUMS.txt line: ${line}`);
    const [, digest, name] = match;
    assert.ok(!result.has(name), `Duplicate checksum entry for ${name}.`);
    result.set(name, digest.toLowerCase());
  }
  return result;
}
