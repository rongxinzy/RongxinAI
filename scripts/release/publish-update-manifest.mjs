import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const [outputPath, releaseVersion, commitSha, ...specs] = process.argv.slice(2);
if (!outputPath || !releaseVersion || !commitSha || specs.length === 0) {
  throw new Error(
    'usage: publish-update-manifest.mjs <output> <version> <commit> <file:platform:arch:variant>...',
  );
}

const keyId = process.env.UPDATE_MANIFEST_KEY_ID;
const privateKeyBase64 = process.env.UPDATE_MANIFEST_PRIVATE_KEY_BASE64;
if (!keyId || !privateKeyBase64) throw new Error('Update signing secrets are required');

const REQUIRED_RELEASE_TARGETS = new Set([
  'win32:x64:lite',
  'darwin:arm64:default',
  'linux:x64:deb',
  'linux:x64:appimage',
]);

const privateKey = crypto.createPrivateKey({
  key: Buffer.from(privateKeyBase64, 'base64'),
  format: 'der',
  type: 'pkcs8',
});

function resolveArtifactFormat(platform, variant, kind = 'installer') {
  if (kind === 'metadata') {
    return { extension: '.yml', contentType: 'application/x-yaml' };
  }
  if (kind === 'blockmap') {
    return { extension: '.blockmap', contentType: 'application/octet-stream' };
  }
  if (kind === 'updater' && platform === 'darwin' && variant === 'default') {
    return { extension: '.zip', contentType: 'application/zip' };
  }
  if (platform === 'win32' && (variant === 'lite' || variant === 'full')) {
    return {
      extension: '.exe',
      contentType: 'application/vnd.microsoft.portable-executable',
    };
  }
  if (platform === 'darwin' && variant === 'default') {
    return { extension: '.dmg', contentType: 'application/x-apple-diskimage' };
  }
  if (platform === 'linux' && variant === 'deb') {
    return { extension: '.deb', contentType: 'application/vnd.debian.binary-package' };
  }
  if (platform === 'linux' && variant === 'appimage') {
    return { extension: '.appimage', contentType: 'application/vnd.appimage' };
  }
  throw new Error(`Unsupported release target: ${platform}:${variant}`);
}

async function localArtifact(spec) {
  const [file, platform, arch, variant] = spec.split(':');
  if (!file || !platform || !arch || !variant) {
    throw new Error(`Invalid artifact spec: ${spec}`);
  }

  const content = await fs.readFile(file);
  const extension = path.extname(file).toLowerCase();
  const format = resolveArtifactFormat(platform, variant);
  if (extension !== format.extension || content.length === 0) {
    throw new Error(`Invalid ${platform} artifact: ${file}`);
  }

  const filename = path.basename(file);
  return {
    platform,
    arch,
    variant,
    filename,
    size: content.length,
    sha256: crypto.createHash('sha256').update(content).digest('hex'),
    sha512: crypto.createHash('sha512').update(content).digest('base64'),
  };
}

async function metadataArtifacts(metadataPath) {
  const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
  if (
    !metadata ||
    metadata.schemaVersion !== 1 ||
    metadata.releaseVersion !== releaseVersion ||
    !Array.isArray(metadata.artifacts)
  ) {
    throw new Error(`Invalid uploaded artifact metadata: ${metadataPath}`);
  }
  return metadata.artifacts.map(artifact => {
    const { platform, arch, variant, kind = 'installer', filename, key, size, sha256, sha512 } = artifact ?? {};
    const format = resolveArtifactFormat(platform, variant, kind);
    const expectedKey =
      kind === 'metadata'
        ? `generations/${releaseVersion}/electron/${platform}-${arch}-${variant}/${filename}`
        : `releases/${releaseVersion}/${platform}-${arch}-${variant}/${filename}`;
    if (
      typeof arch !== 'string' ||
      typeof filename !== 'string' ||
      filename !== path.basename(filename) ||
      path.extname(filename).toLowerCase() !== format.extension ||
      key !== expectedKey ||
      !Number.isSafeInteger(size) ||
      size <= 0 ||
      typeof sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(sha256) ||
      typeof sha512 !== 'string' ||
      !/^[A-Za-z0-9+/]{86}(?:==)?$/.test(sha512)
    ) {
      throw new Error(`Invalid uploaded artifact metadata entry: ${metadataPath}`);
    }
    return { platform, arch, variant, kind, filename, size, sha256, sha512 };
  });
}

const metadataFlag = specs.indexOf('--metadata');
const localSpecs = metadataFlag === -1 ? specs : specs.slice(0, metadataFlag);
const metadataPaths = metadataFlag === -1 ? [] : specs.slice(metadataFlag + 1);
if (metadataFlag !== -1 && metadataPaths.length === 0) {
  throw new Error('Expected at least one metadata file after --metadata');
}

const artifacts = [
  ...(await Promise.all(localSpecs.map(localArtifact))),
  ...(await Promise.all(metadataPaths.map(metadataArtifacts))).flat(),
];
const installerArtifacts = artifacts.filter(({ kind = 'installer' }) => kind === 'installer');
const targets = new Set();
for (const { platform, arch, variant } of installerArtifacts) {
  const target = `${platform}:${arch}:${variant}`;
  if (targets.has(target)) throw new Error(`Duplicate release target: ${target}`);
  targets.add(target);
}
const missingTargets = [...REQUIRED_RELEASE_TARGETS].filter(target => !targets.has(target));
const unexpectedTargets = [...targets].filter(target => !REQUIRED_RELEASE_TARGETS.has(target));
if (missingTargets.length > 0 || unexpectedTargets.length > 0) {
  throw new Error(
    `Release manifest must contain exactly the required targets; missing=${missingTargets.join(',') || 'none'} unexpected=${unexpectedTargets.join(',') || 'none'}`,
  );
}

const manifests = installerArtifacts.map(({ platform, arch, variant, filename, size, sha256, sha512 }) => {
  const format = resolveArtifactFormat(platform, variant);
  const target = `${platform}:${arch}:${variant}`;
  const updaterArtifacts = artifacts.filter(
    artifact =>
      `${artifact.platform}:${artifact.arch}:${artifact.variant}` === target &&
      artifact.kind === 'updater',
  );
  if (metadataPaths.length > 0 && updaterArtifacts.length !== 1) {
    throw new Error(`Release target ${target} must contain exactly one updater artifact`);
  }
  const updaterArtifact = updaterArtifacts[0] ?? { filename, size, sha512 };
  const payload = {
    channel: 'stable',
    version: releaseVersion,
    publishedAt: new Date().toISOString(),
    minimumSupportedVersion: '2026.7.1',
    mandatory: false,
    releaseNotes: {
      zh: { title: `知远智能体 ${releaseVersion}`, items: ['修复若干问题'] },
      en: { title: `ZhiYuan Agent ${releaseVersion}`, items: ['Bug fixes'] },
    },
    artifact: {
      platform,
      arch,
      variant,
      url: `https://downloads.rongxzyai.com/releases/${releaseVersion}/${platform}-${arch}-${variant}/${filename}`,
      size,
      sha256,
      // Existing clients validate these legacy fields. New clients use the
      // nested updater object, which is a ZIP on macOS and therefore differs
      // from the legacy DMG installer.
      sha512,
      contentType: format.contentType,
      updater: {
        filename: updaterArtifact.filename,
        url: `https://downloads.rongxzyai.com/releases/${releaseVersion}/${platform}-${arch}-${variant}/${updaterArtifact.filename}`,
        size: updaterArtifact.size,
        sha512: updaterArtifact.sha512,
      },
    },
    source: {
      commitSha,
      pipelineId: process.env.GITHUB_RUN_ID ?? 'local',
    },
  };
  const payloadBytes = Buffer.from(JSON.stringify(payload));
  return {
    schemaVersion: 1,
    keyId,
    algorithm: 'Ed25519',
    payload: payloadBytes.toString('base64url'),
    signature: crypto.sign(null, payloadBytes, privateKey).toString('base64url'),
  };
});

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, JSON.stringify({ schemaVersion: 1, manifests }));
