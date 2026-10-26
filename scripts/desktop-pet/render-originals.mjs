import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { originalMesh } from './original-mesh.mjs';
import { originalPose, ORIGINAL_MOTION_RIGS } from './original-poses.mjs';
import { sampleCompanionMotion } from './motion.mjs';
import { DesktopPetBuiltinId } from '../../src/shared/desktopPet/catalog.ts';
import {
  DESKTOP_PET_MOTIONS,
  DesktopPetMotion,
} from '../../src/shared/desktopPet/motionCatalog.ts';

const root = fileURLToPath(new URL('../..', import.meta.url));
const assets = path.join(root, 'src/renderer/assets/desktop-pet');
const frames = JSON.parse(await fs.readFile(path.join(assets, 'frames.json'), 'utf8'));
const character = process.argv[2];
const rig = ORIGINAL_MOTION_RIGS[character];
if (!rig) throw new Error('Specify one of the six original companion identities');
const preview = process.argv.includes('--preview');
const output = preview
  ? `/tmp/pet-original-${character}`
  : path.join(assets, 'motion', `${character}-original`);
await fs.mkdir(output, { recursive: true });
const source = await fs.readFile(path.join(assets, `${character}-atlas.png`));
const hash = value => createHash('sha256').update(value).digest('hex');
const browser = await chromium.launch({
  args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage();
  await page.setContent('<canvas width="512" height="512"></canvas>');
  await page.addScriptTag({
    content: `window.meshFactory=${originalMesh.toString()};window.sampleMotion=${sampleCompanionMotion.toString()};`,
  });
  await page.evaluate(
    async ({ source, data, character }) => {
      const image = new Image();
      image.src = source;
      await image.decode();
      window.art = image;
      window.artData = data;
      window.character = character;
      window.canvas = document.querySelector('canvas');
      window.mask = new Uint8Array(512 * 512);
      window.capture = document.createElement('canvas');
      window.capture.width = window.capture.height = 512;
      window.captureContext = window.capture.getContext('2d', { willReadFrequently: true });
    },
    {
      source: `data:image/png;base64,${source.toString('base64')}`,
      data: frames[character],
      character,
    },
  );
  const manifest = {
    sourceSha256: hash(source),
    choreographySha256: hash(
      originalMesh.toString() +
        originalPose.toString() +
        sampleCompanionMotion.toString() +
        JSON.stringify(rig) +
        JSON.stringify(frames[character]),
    ),
    size: 512,
    fps: 30,
    clips: [],
  };
  for (const clip of DESKTOP_PET_MOTIONS) {
    const poseIndex = originalPose(clip.id, DesktopPetMotion);
    await page.evaluate(index => {
      // A fresh context also bounds offline GPU allocations to one clip.
      window.canvas.getContext('webgl')?.getExtension('WEBGL_lose_context')?.loseContext();
      window.canvas.remove();
      window.canvas = document.createElement('canvas');
      window.canvas.width = window.canvas.height = 512;
      document.body.append(window.canvas);
      window.draw = window.meshFactory(
        window.canvas,
        window.art,
        window.artData.frames[index],
        window.artData.unit,
        window.character,
      );
      window.mask.fill(0);
    }, poseIndex);
    const frame = async index =>
      page.evaluate(
        ({ clip, index, rig, ids, characters }) => {
          const pose = window.sampleMotion(clip.id, index / 30, clip.seconds, ids, rig, characters);
          // Facial/head proportions are rigid, with bounded local joint rotation only.
          pose.headAngle = Math.max(-0.1, Math.min(0.1, pose.headAngle));
          pose.headX *= 0.35;
          pose.headY *= 0.45;
          window.draw(pose);
          const context = window.captureContext;
          context.clearRect(0, 0, 512, 512);
          context.drawImage(window.canvas, 0, 0);
          const pixels = context.getImageData(0, 0, 512, 512).data;
          for (let p = 0; p < window.mask.length; p++)
            if (pixels[p * 4 + 3] > 32) window.mask[p] = 255;
          return window.capture.toDataURL('image/png').split(',')[1];
        },
        { clip, index, rig, ids: DesktopPetMotion, characters: DesktopPetBuiltinId },
      );
    if (preview) {
      await fs.writeFile(
        path.join(output, `${clip.id}.png`),
        Buffer.from(await frame(Math.floor(clip.seconds * 30 * 0.37)), 'base64'),
      );
      continue;
    }
    const filename = path.join(output, `${clip.id}.webm`);
    const encoder = spawn(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-f',
        'image2pipe',
        '-framerate',
        '30',
        '-vcodec',
        'png',
        '-i',
        'pipe:0',
        '-an',
        '-c:v',
        'libvpx-vp9',
        '-pix_fmt',
        'yuva420p',
        '-b:v',
        '0',
        '-crf',
        '25',
        '-deadline',
        'good',
        '-cpu-used',
        '5',
        '-threads',
        '2',
        '-auto-alt-ref',
        '0',
        filename,
      ],
      { stdio: ['pipe', 'ignore', 'pipe'] },
    );
    let errors = '';
    encoder.stderr.on('data', data => {
      errors = (errors + data).slice(-8192);
    });
    const complete = new Promise((resolve, reject) => {
      encoder.on('error', reject);
      encoder.on('close', code => (code === 0 ? resolve() : reject(new Error(errors))));
    });
    void complete.catch(() => {});
    try {
      for (let index = 0; index < clip.seconds * 30; index++) {
        const png = Buffer.from(await frame(index), 'base64');
        if (index === Math.floor(clip.seconds * 15))
          await fs.writeFile(path.join(output, `${clip.id}-poster.png`), png);
        if (!encoder.stdin.write(png)) await once(encoder.stdin, 'drain');
      }
      encoder.stdin.end();
      await complete;
    } catch (error) {
      encoder.kill();
      throw error;
    }
    const mask = await page.evaluate(() => {
      const pixels = new ImageData(512, 512),
        bounds = [512, 512, -1, -1];
      for (let p = 0; p < window.mask.length; p++) {
        pixels.data[p * 4 + 3] = window.mask[p];
        if (!window.mask[p]) continue;
        const x = p % 512,
          y = Math.floor(p / 512);
        bounds[0] = Math.min(bounds[0], x);
        bounds[1] = Math.min(bounds[1], y);
        bounds[2] = Math.max(bounds[2], x);
        bounds[3] = Math.max(bounds[3], y);
      }
      if (bounds[0] < 4 || bounds[1] < 4 || bounds[2] > 507 || bounds[3] > 507)
        throw new Error('Original art touches canvas edge');
      window.captureContext.putImageData(pixels, 0, 0);
      return { bounds, png: window.capture.toDataURL('image/png').split(',')[1] };
    });
    await fs.writeFile(path.join(output, `${clip.id}-mask.png`), Buffer.from(mask.png, 'base64'));
    const video = await fs.readFile(filename);
    manifest.clips.push({
      id: clip.id,
      sourcePose: poseIndex,
      seconds: clip.seconds,
      frames: clip.seconds * 30,
      bytes: video.length,
      bounds: mask.bounds,
      sha256: hash(video),
      posterSha256: hash(await fs.readFile(path.join(output, `${clip.id}-poster.png`))),
      maskSha256: hash(await fs.readFile(path.join(output, `${clip.id}-mask.png`))),
    });
    console.log(`${character} ${clip.id} ${video.length}`);
  }
  if (!preview)
    await fs.writeFile(
      path.join(output, 'manifest.json'),
      JSON.stringify(manifest, null, 2) + '\n',
    );
} finally {
  await browser.close();
}
