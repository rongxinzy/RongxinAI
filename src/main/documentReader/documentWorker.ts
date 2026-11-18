import fs from 'node:fs';
import path from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';

import {
  formatFromBytes,
  formatFromExtension,
  initSync,
  toMarkdownBytes,
} from '@firecrawl/anydoc-wasm';

import { safeSlice } from '../../shared/lib/safeSlice';
import { DOCUMENT_MAX_BYTES, DOCUMENT_MAX_CHARACTERS } from './constants';

function readDocument(filePath: string) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > DOCUMENT_MAX_BYTES) {
      throw new Error('Document exceeds the file size limit or is no longer a regular file.');
    }
    const bytes = Buffer.allocUnsafe(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(fd, bytes, offset, bytes.length - offset, null);
      if (!count) break;
      offset += count;
    }

    const module = fs.readFileSync(path.join(__dirname, 'anydoc_wasm_bg.wasm'));
    initSync({ module });
    const input = bytes.subarray(0, offset);
    const format =
      formatFromBytes(input) ?? formatFromExtension(path.extname(filePath).slice(1).toLowerCase());
    const markdown = toMarkdownBytes(input, format);
    return {
      format: format ?? null,
      text: safeSlice(markdown, DOCUMENT_MAX_CHARACTERS),
      markdownCharacters: markdown.length,
    };
  } finally {
    fs.closeSync(fd);
  }
}

try {
  parentPort?.postMessage(readDocument(workerData as string));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  parentPort?.postMessage({ error: safeSlice(message, 1024) });
}
