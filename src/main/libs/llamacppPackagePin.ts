import fs from 'fs';
import path from 'path';

export type LlamaCppPackagePin = {
  runtimeReleaseTag: string;
  runtimeSemanticVersion?: string;
  runtimeSourceCommit?: string;
  runtimeV1TagCommit?: string;
  runtimeAssets: Record<string, string>;
};

let cachedPin: LlamaCppPackagePin | null = null;

function resolvePackageJsonPath(): string {
  return path.join(__dirname, '../../../package.json');
}

export function readLlamaCppPackagePin(): LlamaCppPackagePin {
  if (cachedPin) return cachedPin;
  const raw = fs.readFileSync(resolvePackageJsonPath(), 'utf8');
  const pkg = JSON.parse(raw) as { llamacpp?: Record<string, unknown> };
  const llamacpp = pkg.llamacpp ?? {};
  const runtimeReleaseTag =
    typeof llamacpp.runtimeReleaseTag === 'string' && llamacpp.runtimeReleaseTag.trim()
      ? llamacpp.runtimeReleaseTag.trim()
      : 'b12359';
  const runtimeAssets =
    llamacpp.runtimeAssets && typeof llamacpp.runtimeAssets === 'object'
      ? (llamacpp.runtimeAssets as Record<string, string>)
      : {};
  cachedPin = {
    runtimeReleaseTag,
    runtimeSemanticVersion:
      typeof llamacpp.runtimeSemanticVersion === 'string'
        ? llamacpp.runtimeSemanticVersion
        : undefined,
    runtimeSourceCommit:
      typeof llamacpp.runtimeSourceCommit === 'string' ? llamacpp.runtimeSourceCommit : undefined,
    runtimeV1TagCommit:
      typeof llamacpp.runtimeV1TagCommit === 'string' ? llamacpp.runtimeV1TagCommit : undefined,
    runtimeAssets,
  };
  return cachedPin;
}

export function resolvePinnedLlamaCppRuntimeAssetName(targetId: string): string {
  const pin = readLlamaCppPackagePin();
  const template = pin.runtimeAssets[targetId];
  if (!template?.trim()) {
    throw new Error(`Unsupported prebuilt llama.cpp runtime target: ${targetId}`);
  }
  return template.trim().replace(/\{tag\}/g, pin.runtimeReleaseTag);
}
