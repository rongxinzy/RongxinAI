#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

const ROOT = path.resolve(import.meta.dirname, '../..');
const MANIFEST_PATH = path.join(ROOT, 'resources/llamacpp-smoke-fixtures/manifest.json');

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function readManifest() {
  const raw = fs.readFileSync(MANIFEST_PATH, 'utf8');
  const manifest = JSON.parse(raw);
  if (!manifest?.artifacts || typeof manifest.artifacts !== 'object') {
    throw new Error('[llamacpp-smoke-fixtures] manifest missing artifacts');
  }
  return manifest;
}

async function downloadToFile(url, targetPath) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`[llamacpp-smoke-fixtures] download failed HTTP ${response.status} for ${url}`);
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const tmp = `${targetPath}.part`;
  const file = fs.createWriteStream(tmp);
  try {
    await pipeline(response.body, file);
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw new Error(
      `[llamacpp-smoke-fixtures] stream error for ${url}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  fs.renameSync(tmp, targetPath);
}

export async function ensureLlamaCppSmokeFixtures(options = {}) {
  const cacheDir =
    options.cacheDir?.trim() ||
    process.env.LLAMACPP_SMOKE_FIXTURES_DIR?.trim() ||
    path.join(ROOT, '.cache/llamacpp-smoke-fixtures');
  const manifest = readManifest();
  const resolved = {};
  for (const [key, artifact] of Object.entries(manifest.artifacts)) {
    const fileName = artifact.fileName?.trim();
    const url = artifact.url?.trim();
    const expectedSha = artifact.sha256?.trim().toLowerCase();
    const expectedSize = artifact.sizeBytes;
    if (!fileName || !url || !expectedSha) {
      throw new Error(`[llamacpp-smoke-fixtures] incomplete artifact ${key}`);
    }
    const targetPath = path.join(cacheDir, fileName);
    if (fs.existsSync(targetPath)) {
      const stat = fs.statSync(targetPath);
      const actualSha = sha256File(targetPath);
      if (actualSha === expectedSha && (!expectedSize || stat.size === expectedSize)) {
        resolved[key] = { ...artifact, path: targetPath };
        continue;
      }
      console.warn(
        `[llamacpp-smoke-fixtures] stale cache for ${fileName} (sha or size mismatch); re-downloading`,
      );
      fs.rmSync(targetPath, { force: true });
    }
    console.log(`[llamacpp-smoke-fixtures] downloading ${key}: ${url}`);
    await downloadToFile(url, targetPath);
    const stat = fs.statSync(targetPath);
    const actualSha = sha256File(targetPath);
    if (actualSha !== expectedSha) {
      throw new Error(
        `[llamacpp-smoke-fixtures] SHA-256 mismatch for ${fileName}: expected ${expectedSha}, got ${actualSha}`,
      );
    }
    if (expectedSize && stat.size !== expectedSize) {
      throw new Error(
        `[llamacpp-smoke-fixtures] size mismatch for ${fileName}: expected ${expectedSize}, got ${stat.size}`,
      );
    }
    resolved[key] = { ...artifact, path: targetPath };
  }
  const summaryPath = path.join(cacheDir, 'fixtures-resolved.json');
  fs.writeFileSync(
    summaryPath,
    JSON.stringify({ manifestPath: MANIFEST_PATH, cacheDir, artifacts: resolved }, null, 2),
  );
  return { cacheDir, manifest, artifacts: resolved, summaryPath };
}

async function main() {
  const result = await ensureLlamaCppSmokeFixtures();
  console.log(`[llamacpp-smoke-fixtures] ready under ${result.cacheDir}`);
  for (const [key, artifact] of Object.entries(result.artifacts)) {
    console.log(`  - ${key}: ${artifact.path} (${artifact.sha256})`);
  }
}

import { pathToFileURL } from 'node:url';

const isCli =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isCli) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
