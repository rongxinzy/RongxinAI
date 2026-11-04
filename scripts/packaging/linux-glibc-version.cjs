'use strict';

const { spawnSync } = require('node:child_process');

function parseGlibcVersionToken(token) {
  const match = /^(\d+)\.(\d+)$/.exec(String(token).trim());
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]) };
}

function compareGlibcVersions(left, right) {
  if (left.major !== right.major) return left.major - right.major;
  return left.minor - right.minor;
}

function formatGlibcVersion(version) {
  return `${version.major}.${version.minor}`;
}

function maxGlibcVersionFromSymbols(symbolVersions) {
  return symbolVersions.reduce(
    (max, version) => (compareGlibcVersions(version, max) > 0 ? version : max),
    { major: 0, minor: 0 },
  );
}

function extractGlibcSymbolVersions(objdumpOutput) {
  const versions = [];
  for (const match of String(objdumpOutput).matchAll(/GLIBC_(\d+\.\d+)/g)) {
    const parsed = parseGlibcVersionToken(match[1]);
    if (parsed) versions.push(parsed);
  }
  return versions;
}

function readObjdumpDynamicSymbols(binaryPath) {
  const result = spawnSync('objdump', ['-T', binaryPath], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error(`[LinuxGlibcVerify] objdump failed for ${binaryPath}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `[LinuxGlibcVerify] objdump exited ${result.status} for ${binaryPath}: ${result.stderr || result.stdout}`,
    );
  }
  return result.stdout;
}

function readMaxGlibcVersionFromBinary(binaryPath) {
  const versions = extractGlibcSymbolVersions(readObjdumpDynamicSymbols(binaryPath));
  if (versions.length === 0) {
    throw new Error(`[LinuxGlibcVerify] No GLIBC_* symbol versions found in ${binaryPath}`);
  }
  return formatGlibcVersion(maxGlibcVersionFromSymbols(versions));
}

function assertMaxGlibcVersion(binaryPath, maxAllowedVersion, options = {}) {
  const allowed = parseGlibcVersionToken(maxAllowedVersion);
  if (!allowed) {
    throw new Error(`[LinuxGlibcVerify] Invalid max allowed glibc version: ${maxAllowedVersion}`);
  }
  const observedText =
    typeof options.objdumpOutput === 'string'
      ? formatGlibcVersion(
          maxGlibcVersionFromSymbols(extractGlibcSymbolVersions(options.objdumpOutput)),
        )
      : readMaxGlibcVersionFromBinary(binaryPath);
  const observed = parseGlibcVersionToken(observedText);
  if (!observed) {
    throw new Error(`[LinuxGlibcVerify] Could not parse observed glibc version for ${binaryPath}`);
  }
  if (compareGlibcVersions(observed, allowed) > 0) {
    throw new Error(
      `[LinuxGlibcVerify] ${binaryPath} requires GLIBC_${formatGlibcVersion(observed)}, ` +
        `which exceeds the packaged Linux baseline GLIBC_${formatGlibcVersion(allowed)}.`,
    );
  }
  return formatGlibcVersion(observed);
}

module.exports = {
  assertMaxGlibcVersion,
  compareGlibcVersions,
  extractGlibcSymbolVersions,
  formatGlibcVersion,
  maxGlibcVersionFromSymbols,
  readMaxGlibcVersionFromBinary,
};
