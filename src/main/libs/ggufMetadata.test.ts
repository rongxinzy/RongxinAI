import fs from 'fs';
import os from 'os';
import path from 'path';
import { expect, test } from 'vitest';

import { ggufSupportsThinkingToggle } from './ggufMetadata';

const GgufValueType = {
  String: 8,
} as const;

test('recognizes enable_thinking from a GGUF chat template', () => {
  const filePath = writeGgufMetadata({
    'tokenizer.chat_template': '{% if enable_thinking %}<think>{% endif %}',
  });

  expect(ggufSupportsThinkingToggle(filePath)).toBe(true);
});

test('does not enable the toggle for templates without enable_thinking', () => {
  const filePath = writeGgufMetadata({
    'tokenizer.chat_template': '{{ messages }}',
  });

  expect(ggufSupportsThinkingToggle(filePath)).toBe(false);
});

test('returns false for invalid GGUF files', () => {
  const filePath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'gguf-metadata-')),
    'invalid.gguf',
  );
  fs.writeFileSync(filePath, 'not a gguf');

  expect(ggufSupportsThinkingToggle(filePath)).toBe(false);
});

function writeGgufMetadata(metadata: Record<string, string>): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gguf-metadata-'));
  const entries = Object.entries(metadata).map(([key, value]) =>
    Buffer.concat([writeString(key), writeUint32(GgufValueType.String), writeString(value)]),
  );
  const header = Buffer.concat([
    writeUint32(0x46554747),
    writeUint32(3),
    writeUint64(0),
    writeUint64(entries.length),
  ]);
  const filePath = path.join(directory, 'model.gguf');
  fs.writeFileSync(filePath, Buffer.concat([header, ...entries]));
  return filePath;
}

function writeUint32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
}

function writeUint64(value: number): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
}

function writeString(value: string): Buffer {
  const content = Buffer.from(value, 'utf8');
  return Buffer.concat([writeUint64(content.length), content]);
}
