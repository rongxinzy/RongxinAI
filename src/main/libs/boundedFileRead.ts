import { open } from 'node:fs/promises';

export async function readBoundedFile(
  filePath: string,
  limit: number,
  signal?: AbortSignal,
): Promise<Buffer> {
  signal?.throwIfAborted();
  const file = await open(filePath, 'r');
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > limit) throw new Error('File exceeds its size limit.');
    const buffer = Buffer.alloc(limit + 1);
    let size = 0;
    while (size < buffer.byteLength) {
      signal?.throwIfAborted();
      const { bytesRead } = await file.read(buffer, size, buffer.byteLength - size, null);
      if (bytesRead === 0) break;
      size += bytesRead;
    }
    signal?.throwIfAborted();
    if (size > limit) throw new Error('File exceeds its size limit.');
    return buffer.subarray(0, size);
  } finally {
    await file.close();
  }
}
