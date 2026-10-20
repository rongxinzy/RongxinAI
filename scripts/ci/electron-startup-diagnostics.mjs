import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const MAX_OUTPUT_BYTES = 256 * 1024;

export function captureElectronStartup(child, maximumBytes = MAX_OUTPUT_BYTES) {
  const output = { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  for (const stream of ['stdout', 'stderr']) {
    child[stream]?.on('data', chunk => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      output[stream] = Buffer.from(Buffer.concat([output[stream], bytes]).subarray(-maximumBytes));
    });
  }
  return async directory => {
    await Promise.all(
      Object.entries(output).map(([stream, bytes]) =>
        writeFile(path.join(directory, `electron-${stream}.log`), bytes),
      ),
    );
  };
}
