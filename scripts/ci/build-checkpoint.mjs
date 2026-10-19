import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

async function digest(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function checkpoint(action, directory, identity, paths = [], root = process.cwd()) {
  const archive = path.resolve(directory, 'payload.tar');
  const metadata = path.resolve(directory, 'identity.json');
  for (const key of ['commit', 'runId', 'target', 'version']) {
    if (!identity[key]) throw new Error(`Missing checkpoint identity: ${key}`);
  }
  if (action === 'create') {
    if (!paths.length || paths.some(file => !existsSync(path.join(root, file)))) {
      throw new Error('Checkpoint inputs are missing');
    }
    mkdirSync(directory, { recursive: true });
    // TAR retains executable bits and symlinks. Do not recompress signed installers/7z.
    execFileSync('tar', ['-cf', archive, ...paths], { cwd: root, stdio: 'inherit' });
    writeFileSync(metadata, JSON.stringify({ ...identity, sha256: await digest(archive) }));
  } else if (action === 'restore') {
    const saved = JSON.parse(readFileSync(metadata, 'utf8'));
    for (const key of ['commit', 'runId', 'target', 'version']) {
      if (saved[key] !== identity[key]) throw new Error(`Checkpoint ${key} mismatch`);
    }
    if (saved.sha256 !== (await digest(archive))) throw new Error('Checkpoint SHA-256 mismatch');
    execFileSync('tar', ['-xf', archive], { cwd: root, stdio: 'inherit' });
    if (process.env.GITHUB_ENV && typeof saved.macAutoUpdateEnabled === 'boolean') {
      appendFileSync(
        process.env.GITHUB_ENV,
        `ZHIYUAN_MAC_AUTO_UPDATE_ENABLED=${saved.macAutoUpdateEnabled}\n`,
      );
    }
  } else {
    throw new Error('Expected create or restore');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [action, directory, target, ...paths] = process.argv.slice(2);
  const identity = {
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    runId: process.env.GITHUB_RUN_ID,
    version: process.env.APP_BUILD_VERSION || 'verify',
    target,
    macAutoUpdateEnabled: process.env.ZHIYUAN_MAC_AUTO_UPDATE_ENABLED === 'true',
  };
  await checkpoint(action, directory, identity, paths);
}
