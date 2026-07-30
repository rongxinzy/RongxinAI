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

const privateKey = crypto.createPrivateKey({
  key: Buffer.from(privateKeyBase64, 'base64'),
  format: 'der',
  type: 'pkcs8',
});

function resolveArtifactFormat(platform, variant) {
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

const artifacts = await Promise.all(
  specs.map(async spec => {
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
        size: content.length,
        sha256: crypto.createHash('sha256').update(content).digest('hex'),
        contentType: format.contentType,
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
  }),
);

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, JSON.stringify({ schemaVersion: 1, manifests: artifacts }));
