import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  DesktopPetMotion,
  DESKTOP_PET_MEDIA_FPS,
  DESKTOP_PET_MEDIA_SIZE,
  DESKTOP_PET_MOTIONS,
} from '../../../src/shared/desktopPet/motionCatalog.ts';
import { OWL_RIG_FRAMES, drawOwlRig } from './owl-rig.mjs';
import { sampleOwlMotion } from './owl-motion.mjs';
import { verifyMotion } from './verify-motion.mjs';

// Offline artwork build only. No application process, model or user workspace is involved.
const root = fileURLToPath(new URL('../../..', import.meta.url));
const { values } = parseArgs({
  options: {
    preview: { type: 'boolean' },
    verify: { type: 'boolean' },
    clip: { type: 'string' },
    out: { type: 'string' },
  },
});
const output = path.resolve(
  values.out ?? path.join(root, 'src/renderer/assets/desktop-pet/motion/xiaoyuan'),
);
const selected = values.clip
  ? DESKTOP_PET_MOTIONS.filter(clip => clip.id === values.clip)
  : DESKTOP_PET_MOTIONS;
if (!selected.length) throw new Error('Unknown motion clip');
const source = await fs.readFile(
  path.join(root, 'src/renderer/assets/desktop-pet/rigs/xiaoyuan-rig-v1.png'),
);
const hash = buffer => createHash('sha256').update(buffer).digest('hex');
const choreographySha256 = hash(
  JSON.stringify({
    draw: drawOwlRig.toString(),
    motion: sampleOwlMotion.toString(),
    frames: OWL_RIG_FRAMES,
  }),
);
if (values.verify) {
  console.log(JSON.stringify(await verifyMotion(output, hash(source), choreographySha256)));
  process.exit(0);
}
const encoderVersion = values.preview
  ? null
  : execFileSync('ffmpeg', ['-version'], {
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: 65536,
    }).split('\n')[0];
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setContent('<canvas width="512" height="512"></canvas>');
  await page.addScriptTag({
    content: `window.drawRig = ${drawOwlRig.toString()}; window.sampleMotion = ${sampleOwlMotion.toString()};`,
  });
  await page.evaluate(
    async ({ data, frames, ids, size }) => {
      const image = new Image();
      image.src = data;
      await image.decode();
      window.rig = image;
      window.parts = frames;
      window.clips = ids;
      window.canvas = document.querySelector('canvas');
      window.context = window.canvas.getContext('2d', { willReadFrequently: true });
      window.union = new Uint8Array(size * size);
    },
    {
      data: `data:image/png;base64,${source.toString('base64')}`,
      frames: OWL_RIG_FRAMES,
      ids: DesktopPetMotion,
      size: DESKTOP_PET_MEDIA_SIZE,
    },
  );
  const frame = async (clip, index) =>
    page.evaluate(
      ({ clip, index, fps, size }) => {
        const pose = window.sampleMotion(clip.id, index / fps, clip.seconds, window.clips);
        window.drawRig(window.context, window.rig, window.parts, pose);
        const pixels = window.context.getImageData(0, 0, size, size).data;
        for (let i = 0; i < window.union.length; i++)
          if (pixels[i * 4 + 3] > 32) window.union[i] = 255;
        return window.canvas.toDataURL('image/png').split(',')[1];
      },
      { clip, index, fps: DESKTOP_PET_MEDIA_FPS, size: DESKTOP_PET_MEDIA_SIZE },
    );

  if (values.preview) {
    const examples = [
      DesktopPetMotion.Idle,
      DesktopPetMotion.Think,
      DesktopPetMotion.Wave,
      DesktopPetMotion.Flutter,
      DesktopPetMotion.Concern,
      DesktopPetMotion.Stretch,
      DesktopPetMotion.Preen,
      DesktopPetMotion.Walk,
    ];
    for (const id of examples) {
      const clip = DESKTOP_PET_MOTIONS.find(clip => clip.id === id);
      const png = await frame(clip, Math.floor((clip.seconds * DESKTOP_PET_MEDIA_FPS) / 2));
      await fs.writeFile(path.join(output, `${id}.png`), Buffer.from(png, 'base64'));
    }
    console.log(JSON.stringify({ preview: true, output, sourceSha256: hash(source) }));
  } else {
    const manifest = {
      sourceSha256: hash(source),
      choreographySha256,
      chromium: browser.version(),
      encoder: encoderVersion,
      size: DESKTOP_PET_MEDIA_SIZE,
      fps: DESKTOP_PET_MEDIA_FPS,
      clips: [],
    };
    for (const clip of selected) {
      await page.evaluate(() => window.union.fill(0));
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
          String(DESKTOP_PET_MEDIA_FPS),
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
          '-auto-alt-ref',
          '0',
          filename,
        ],
        { stdio: ['pipe', 'ignore', 'pipe'] },
      );
      let errors = '';
      encoder.stderr.on('data', chunk => {
        errors = (errors + chunk.toString()).slice(-8192);
      });
      const completed = new Promise((resolve, reject) => {
        encoder.on('error', reject);
        encoder.on('close', code =>
          code === 0 ? resolve() : reject(new Error(`Motion encoder failed: ${errors}`)),
        );
      });
      // Register a rejection handler before rendering starts; await the same promise below.
      void completed.catch(() => {});
      const frames = clip.seconds * DESKTOP_PET_MEDIA_FPS;
      try {
        for (let index = 0; index < frames; index++) {
          const png = Buffer.from(await frame(clip, index), 'base64');
          if (index === Math.floor(frames / 2))
            await fs.writeFile(path.join(output, `${clip.id}-poster.png`), png);
          if (!encoder.stdin.write(png)) await once(encoder.stdin, 'drain');
        }
        encoder.stdin.end();
        await completed;
      } catch (error) {
        encoder.kill();
        throw error;
      }
      const mask = await page.evaluate(size => {
        const pixels = new ImageData(size, size);
        for (let index = 0; index < window.union.length; index++) {
          pixels.data[index * 4] = pixels.data[index * 4 + 1] = pixels.data[index * 4 + 2] = 255;
          pixels.data[index * 4 + 3] = window.union[index];
        }
        window.context.putImageData(pixels, 0, 0);
        return window.canvas.toDataURL('image/png').split(',')[1];
      }, DESKTOP_PET_MEDIA_SIZE);
      await fs.writeFile(path.join(output, `${clip.id}-mask.png`), Buffer.from(mask, 'base64'));
      const bytes = await fs.readFile(filename);
      const entry = {
        id: clip.id,
        frames,
        seconds: clip.seconds,
        bytes: bytes.length,
        sha256: hash(bytes),
        posterSha256: hash(await fs.readFile(path.join(output, `${clip.id}-poster.png`))),
        maskSha256: hash(await fs.readFile(path.join(output, `${clip.id}-mask.png`))),
      };
      manifest.clips.push(entry);
      console.log(JSON.stringify(entry));
    }
    await fs.writeFile(
      path.join(output, values.clip ? `${values.clip}-manifest.json` : 'manifest.json'),
      JSON.stringify(manifest, null, 2) + '\n',
    );
  }
} finally {
  await browser.close();
}
