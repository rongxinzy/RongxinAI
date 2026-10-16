import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { TARGETS, upstream, binaryName, sha256File } = require('../magpie-runtime.cjs');

const MANIFEST_LIMIT_BYTES = 16_384;

/**
 * True only for the pinned Magpie gateway executable at
 * resources/magpie/<target>/<binary>. The sibling manifest must name the
 * upstream version and commit, and the file hash must be the unmodified
 * compiler digest. Every other path under resources/ is still scanned.
 */
export function isPinnedMagpieGatewayBinary(root, relativePath) {
  const normalized = relativePath.split(path.sep).join('/');
  const match = /^resources\/magpie\/([^/]+)\/([^/]+)$/.exec(normalized);
  if (!match) return false;
  const [, key, filename] = match;
  if (!Object.hasOwn(TARGETS, key) || filename !== binaryName(key)) return false;

  const directory = path.join(root, 'resources', 'magpie', key);
  const manifestPath = path.join(directory, 'manifest.json');
  let manifest;
  try {
    const manifestStat = fs.lstatSync(manifestPath);
    if (!manifestStat.isFile() || manifestStat.size > MANIFEST_LIMIT_BYTES) return false;
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    return false;
  }
  if (
    manifest.schemaVersion !== 1 ||
    manifest.version !== upstream.version ||
    manifest.source?.commit !== upstream.commit ||
    manifest.binary !== filename ||
    manifest.platform !== TARGETS[key].platform ||
    manifest.arch !== TARGETS[key].arch ||
    typeof manifest.sha256 !== 'string' ||
    manifest.sha256 !== manifest.buildSha256 ||
    !/^[a-f0-9]{64}$/.test(manifest.sha256)
  ) {
    return false;
  }

  try {
    const binaryPath = path.join(directory, filename);
    const binaryStat = fs.lstatSync(binaryPath);
    if (!binaryStat.isFile()) return false;
    return sha256File(binaryPath) === manifest.sha256;
  } catch {
    return false;
  }
}
