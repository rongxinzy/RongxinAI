import fs from 'node:fs';
import path from 'node:path';

export type LlamaCppSmokeFixtureArtifact = {
  id: string;
  revision: string;
  fileName: string;
  url: string;
  sha256: string;
  sizeBytes: number;
  modalityNote?: string;
  path?: string;
};

export type LlamaCppSmokeFixtureManifest = {
  schemaVersion: number;
  runtimeReleaseTag: string;
  artifacts: {
    textCpu: LlamaCppSmokeFixtureArtifact;
    visionCpu: LlamaCppSmokeFixtureArtifact;
    visionMmproj: LlamaCppSmokeFixtureArtifact;
  };
};

const MANIFEST_RELATIVE = 'resources/llamacpp-smoke-fixtures/manifest.json';

export function readLlamaCppSmokeFixtureManifest(rootDir = process.cwd()): LlamaCppSmokeFixtureManifest {
  const manifestPath = path.join(rootDir, MANIFEST_RELATIVE);
  const raw = fs.readFileSync(manifestPath, 'utf8');
  return JSON.parse(raw) as LlamaCppSmokeFixtureManifest;
}

export function resolveLlamaCppSmokeFixturesDir(rootDir = process.cwd()): string {
  return (
    process.env.LLAMACPP_SMOKE_FIXTURES_DIR?.trim() ||
    path.join(rootDir, '.cache/llamacpp-smoke-fixtures')
  );
}

export function resolveSmokeFixturePath(
  artifact: Pick<LlamaCppSmokeFixtureArtifact, 'fileName'>,
  rootDir = process.cwd(),
): string {
  return path.join(resolveLlamaCppSmokeFixturesDir(rootDir), artifact.fileName);
}

export function assertSmokeFixturesPresent(manifest: LlamaCppSmokeFixtureManifest, rootDir = process.cwd()) {
  const missing: string[] = [];
  for (const artifact of Object.values(manifest.artifacts)) {
    const target = resolveSmokeFixturePath(artifact, rootDir);
    if (!fs.existsSync(target)) {
      missing.push(`${artifact.id} (${artifact.fileName})`);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `llama.cpp smoke fixtures missing: ${missing.join(', ')}. Run: node scripts/llamacpp/download-smoke-fixtures.mjs`,
    );
  }
}
