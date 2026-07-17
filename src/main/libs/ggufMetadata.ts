import fs from 'fs';

const GGUF_MAGIC = 0x46554747;
const MAX_METADATA_STRING_BYTES = 4 * 1024 * 1024;
const METADATA_READ_BUFFER_BYTES = 64 * 1024;

const GgufValueType = {
  Uint8: 0,
  Int8: 1,
  Uint16: 2,
  Int16: 3,
  Uint32: 4,
  Int32: 5,
  Float32: 6,
  Bool: 7,
  String: 8,
  Array: 9,
  Uint64: 10,
  Int64: 11,
  Float64: 12,
} as const;

/**
 * Reads GGUF metadata only. Models whose chat template declares
 * `enable_thinking` can expose a safe on/off control in the chat UI.
 */
export function ggufSupportsThinkingToggle(filePath: string): boolean {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(filePath, 'r');
    const reader = new GgufReader(descriptor);
    if (reader.readUint32() !== GGUF_MAGIC) return false;

    reader.readUint32(); // GGUF version
    reader.readUint64(); // tensor count
    const metadataCount = reader.readUint64();

    for (let index = 0; index < metadataCount; index += 1) {
      const key = reader.readString();
      const valueType = reader.readUint32();
      const value = reader.readValue(valueType, key.startsWith('tokenizer.chat_template'));
      if (key.startsWith('tokenizer.chat_template') && containsThinkingToggle(value)) {
        return true;
      }
    }
  } catch {
    return false;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  return false;
}

function containsThinkingToggle(value: unknown): boolean {
  if (typeof value === 'string') return value.includes('enable_thinking');
  return Array.isArray(value) && value.some(containsThinkingToggle);
}

class GgufReader {
  private position = 0;

  constructor(private readonly descriptor: number) {}

  readUint32(): number {
    const buffer = this.readBuffer(4);
    return buffer.readUInt32LE();
  }

  readUint64(): number {
    const buffer = this.readBuffer(8);
    const value = buffer.readBigUInt64LE();
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('GGUF metadata value exceeds JavaScript safe integer range.');
    }
    return Number(value);
  }

  readString(): string {
    const length = this.readUint64();
    if (length > MAX_METADATA_STRING_BYTES) {
      throw new Error('GGUF metadata string is too large.');
    }
    return this.readBuffer(length).toString('utf8');
  }

  readValue(valueType: number, retainStrings: boolean): unknown {
    switch (valueType) {
      case GgufValueType.Uint8:
      case GgufValueType.Int8:
      case GgufValueType.Bool:
        return this.skip(1);
      case GgufValueType.Uint16:
      case GgufValueType.Int16:
        return this.skip(2);
      case GgufValueType.Uint32:
      case GgufValueType.Int32:
      case GgufValueType.Float32:
        return this.skip(4);
      case GgufValueType.Uint64:
      case GgufValueType.Int64:
      case GgufValueType.Float64:
        return this.skip(8);
      case GgufValueType.String: {
        return retainStrings ? this.readString() : this.skipString();
      }
      case GgufValueType.Array:
        return this.readArray(retainStrings);
      default:
        throw new Error(`Unsupported GGUF metadata value type: ${valueType}`);
    }
  }

  private readArray(retainStrings: boolean): unknown[] | undefined {
    const valueType = this.readUint32();
    const length = this.readUint64();
    const values = retainStrings ? ([] as unknown[]) : undefined;
    for (let index = 0; index < length; index += 1) {
      const value = this.readValue(valueType, retainStrings);
      if (values) values.push(value);
    }
    return values;
  }

  private skip(length: number): undefined {
    this.position += length;
    return undefined;
  }

  private skipString(): undefined {
    this.skip(this.readUint64());
    return undefined;
  }

  private readBuffer(length: number): Buffer {
    if (length <= METADATA_READ_BUFFER_BYTES && this.hasBufferedRange(length)) {
      const offset = this.position - this.bufferStart;
      this.position += length;
      return this.buffer.subarray(offset, offset + length);
    }

    if (length <= METADATA_READ_BUFFER_BYTES) {
      this.fillBuffer();
      if (!this.hasBufferedRange(length)) throw new Error('Unexpected end of GGUF metadata.');
      const offset = this.position - this.bufferStart;
      this.position += length;
      return this.buffer.subarray(offset, offset + length);
    }

    const buffer = Buffer.allocUnsafe(length);
    const bytesRead = fs.readSync(this.descriptor, buffer, 0, length, this.position);
    if (bytesRead !== length) throw new Error('Unexpected end of GGUF metadata.');
    this.position += length;
    return buffer;
  }

  private readonly buffer = Buffer.allocUnsafe(METADATA_READ_BUFFER_BYTES);
  private bufferStart = 0;
  private bufferLength = 0;

  private hasBufferedRange(length: number): boolean {
    return (
      this.position >= this.bufferStart &&
      this.position + length <= this.bufferStart + this.bufferLength
    );
  }

  private fillBuffer(): void {
    this.bufferStart = this.position;
    this.bufferLength = fs.readSync(
      this.descriptor,
      this.buffer,
      0,
      this.buffer.length,
      this.bufferStart,
    );
    if (this.bufferLength === 0) throw new Error('Unexpected end of GGUF metadata.');
  }
}
