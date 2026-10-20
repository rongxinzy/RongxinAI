import fs from 'fs';
import os from 'os';
import path from 'path';
import { expect, test } from 'vitest';

import { ggufSupportsThinkingToggle, readGgufBlockCount } from './ggufMetadata';

const GgufValueType = {
  String: 8,
  Uint32: 4,
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

test('reads the architecture block_count (Qwen3-30B-A3B: 48 layers)', () => {
  const filePath = writeGgufMetadataWithTypes({
    'general.architecture': ['qwen3moe', GgufValueType.String],
    'qwen3moe.block_count': [48, GgufValueType.Uint32],
  });

  expect(readGgufBlockCount(filePath)).toBe(48);
});

test('readGgufBlockCount returns undefined without an architecture block_count', () => {
  const filePath = writeGgufMetadata({
    'tokenizer.chat_template': '{{ messages }}',
  });

  expect(readGgufBlockCount(filePath)).toBeUndefined();
});

test('readGgufBlockCount returns undefined for invalid GGUF files', () => {
  const filePath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'gguf-metadata-')),
    'invalid.gguf',
  );
  fs.writeFileSync(filePath, 'not a gguf');

  expect(readGgufBlockCount(filePath)).toBeUndefined();
});

function writeGgufMetadata(metadata: Record<string, string>): string {
  return writeGgufMetadataWithTypes(
    Object.fromEntries(
      Object.entries(metadata).map(([key, value]) => [key, [value, GgufValueType.String]]),
    ),
  );
}

function writeGgufMetadataWithTypes(metadata: Record<string, [string | number, number]>): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gguf-metadata-'));
  const entries = Object.entries(metadata).map(([key, [value, valueType]]) =>
    Buffer.concat([writeString(key), writeUint32(valueType), writeTypedValue(value, valueType)]),
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

function writeTypedValue(value: string | number, valueType: number): Buffer {
  if (valueType === GgufValueType.Uint32) return writeUint32(value as number);
  return writeString(value as string);
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
