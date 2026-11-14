import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';

export const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
export const imageLimits = { maxWidth: 2000, maxHeight: 2000, maxBytes: 4.5 * 1024 * 1024 };

export function bitmap(width = 4096, height = 2048): Uint8Array {
  const bytes = Buffer.alloc(54 + width * height * 3, 187);
  bytes.fill(0, 0, 54);
  bytes.write('BM');
  bytes.writeUInt32LE(bytes.length, 2);
  bytes.writeUInt32LE(54, 10);
  bytes.writeUInt32LE(40, 14);
  bytes.writeInt32LE(width, 18);
  bytes.writeInt32LE(height, 22);
  bytes.writeUInt16LE(1, 26);
  bytes.writeUInt16LE(24, 28);
  return bytes;
}

/** Test-only production-style CJS bundles in a folder without node_modules. */
export async function buildDurableImageFixture() {
  const directory = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'durable-image-worker-')),
  );
  for (const [name, entry] of [
    ['artifactWorker', 'src/main/workbenchTask/artifactWorker.ts'],
    ['imageProcessor', 'src/main/libs/agentEngine/durableImages.ts'],
  ]) {
    await build({
      configFile: false,
      logLevel: 'silent',
      ssr: { noExternal: true },
      build: {
        ssr: true,
        outDir: directory,
        emptyOutDir: false,
        minify: false,
        rolldownOptions: {
          input: { [name]: path.resolve(entry) },
          external: [/^node:/],
          output: { format: 'cjs', entryFileNames: '[name].js', codeSplitting: false },
        },
      },
    });
  }
  fs.copyFileSync(
    path.resolve('node_modules/@silvia-odwyer/photon/photon_rs_bg.wasm'),
    path.join(directory, 'companion-photon.wasm'),
  );
  fs.writeFileSync(
    path.join(directory, 'nonresponsiveWorker.cjs'),
    "require('node:worker_threads').parentPort.on('message', () => {});",
  );
  return directory;
}
