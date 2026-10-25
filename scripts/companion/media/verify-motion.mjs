import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { verifyMotionMask } from './verify-motion-mask.mjs';
import {
  DESKTOP_PET_MOTIONS,
  DESKTOP_PET_MEDIA_FPS,
  DESKTOP_PET_MEDIA_SIZE,
} from '../../../src/shared/desktopPet/motionCatalog.ts';

const execute = promisify(execFile);
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_PACK_BYTES = 40 * 1024 * 1024;
const sha = data => createHash('sha256').update(data).digest('hex');

/** Offline full-frame verification; no test skips, threshold edits or source-file ignores. */
export async function verifyMotion(output, sourceSha256, choreographySha256) {
  const manifestBytes = await fs.readFile(path.join(output, 'manifest.json'));
  if (manifestBytes.length > 100_000) throw new Error('Motion manifest exceeds its bound');
  const manifest = JSON.parse(manifestBytes);
  if (manifest.sourceSha256 !== sourceSha256 || manifest.choreographySha256 !== choreographySha256)
    throw new Error('Motion sources have changed; rebuild the complete pack');
  if (
    manifest.size !== DESKTOP_PET_MEDIA_SIZE ||
    manifest.fps !== DESKTOP_PET_MEDIA_FPS ||
    manifest.clips.length !== DESKTOP_PET_MOTIONS.length
  )
    throw new Error('Motion manifest does not match the authored catalog');
  const ids = new Set(manifest.clips.map(clip => clip.id));
  if (ids.size !== DESKTOP_PET_MOTIONS.length)
    throw new Error('Motion manifest contains duplicate clips');
  let bytes = manifestBytes.length;
  for (const clip of DESKTOP_PET_MOTIONS) {
    const entry = manifest.clips.find(entry => entry.id === clip.id);
    if (
      !entry ||
      entry.frames !== clip.seconds * DESKTOP_PET_MEDIA_FPS ||
      entry.seconds !== clip.seconds
    )
      throw new Error(`Invalid authored timing: ${clip.id}`);
    for (const [suffix, digest] of [
      ['.webm', entry.sha256],
      ['-poster.png', entry.posterSha256],
      ['-mask.png', entry.maskSha256],
    ]) {
      const file = await fs.readFile(path.join(output, `${clip.id}${suffix}`));
      if (file.length > MAX_FILE_BYTES)
        throw new Error(`Motion asset exceeds the existing file budget: ${clip.id}${suffix}`);
      if (sha(file) !== digest)
        throw new Error(`Motion asset digest mismatch: ${clip.id}${suffix}`);
      bytes += file.length;
    }
    await verifyMotionMask(
      path.join(output, `${clip.id}-mask.png`),
      DESKTOP_PET_MEDIA_SIZE,
      entry.bounds,
    );
    const { stdout, stderr } = await execute(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'info',
        '-threads',
        '2',
        '-c:v',
        'libvpx-vp9',
        '-i',
        path.join(output, `${clip.id}.webm`),
        '-map',
        '0:v:0',
        '-an',
        '-pix_fmt',
        'rgba',
        '-f',
        'framemd5',
        '-',
      ],
      { encoding: 'utf8', timeout: 15_000, maxBuffer: 1024 * 1024 },
    );
    const frames = stdout.split('\n').filter(line => /^\s*0,/.test(line));
    if (
      frames.length !== entry.frames ||
      !stdout.includes(`#dimensions 0: ${DESKTOP_PET_MEDIA_SIZE}x${DESKTOP_PET_MEDIA_SIZE}`) ||
      !stdout.includes(`#tb 0: 1/${DESKTOP_PET_MEDIA_FPS}`) ||
      !/alpha_mode\s*:\s*1/i.test(stderr)
    )
      throw new Error(`Decoded motion does not match its alpha/frame contract: ${clip.id}`);
    if (new Set(frames.map(line => line.split(',').at(-1).trim())).size < 16)
      throw new Error(`Motion contains insufficient distinct decoded frames: ${clip.id}`);
  }
  if (bytes > MAX_PACK_BYTES) throw new Error('Motion pack exceeds its 40 MiB resource budget');
  return {
    clips: ids.size,
    frames: manifest.clips.reduce((sum, clip) => sum + clip.frames, 0),
    bytes,
    fps: manifest.fps,
    alpha: true,
  };
}
