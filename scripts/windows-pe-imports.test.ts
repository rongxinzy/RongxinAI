import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { verifyWindowsDllClosure } = require('./windows-pe-imports.cjs') as {
  verifyWindowsDllClosure: (
    binDir: string,
    executable: string,
    options?: { isSystemDll?: (name: string) => boolean; extraRoots?: string[] },
  ) => string[];
};

const roots: string[] = [];
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Minimal PE32+ image: one section at RVA 0x1000 holding import descriptors and names. */
function buildPe(imports: string[], delayImports: string[] = []): Buffer {
  const fileAlignment = 0x200;
  const sectionRva = 0x1000;
  const peOffset = 0x40;
  const optionalSize = 240;
  const sectionTable = peOffset + 24 + optionalSize;
  const rawPointer = fileAlignment;
  const section = Buffer.alloc(0x1000);
  let cursor = 0;
  const importTable = cursor;
  cursor += (imports.length + 1) * 20;
  const delayTable = cursor;
  cursor += (delayImports.length + 1) * 32;
  const writeName = (name: string) => {
    const at = cursor;
    section.write(`${name}\0`, at, 'latin1');
    cursor += name.length + 1;
    return sectionRva + at;
  };
  imports.forEach((name, index) => {
    section.writeUInt32LE(writeName(name), importTable + index * 20 + 12);
  });
  delayImports.forEach((name, index) => {
    section.writeUInt32LE(writeName(name), delayTable + index * 32 + 4);
  });
  const header = Buffer.alloc(rawPointer);
  header.writeUInt16LE(0x5a4d, 0);
  header.writeUInt32LE(peOffset, 60);
  header.writeUInt32LE(0x4550, peOffset);
  header.writeUInt16LE(0x8664, peOffset + 4);
  header.writeUInt16LE(1, peOffset + 6);
  header.writeUInt16LE(optionalSize, peOffset + 20);
  const optional = peOffset + 24;
  header.writeUInt16LE(0x20b, optional);
  const dataDirectories = optional + 112;
  if (imports.length > 0) header.writeUInt32LE(sectionRva + importTable, dataDirectories + 8);
  if (delayImports.length > 0) {
    header.writeUInt32LE(sectionRva + delayTable, dataDirectories + 13 * 8);
  }
  header.write('.idata\0\0', sectionTable, 'latin1');
  header.writeUInt32LE(section.length, sectionTable + 8);
  header.writeUInt32LE(sectionRva, sectionTable + 12);
  header.writeUInt32LE(section.length, sectionTable + 16);
  header.writeUInt32LE(rawPointer, sectionTable + 20);
  return Buffer.concat([header, section]);
}

const isSystemDll = (name: string) => ['kernel32.dll', 'msvcp140.dll'].includes(name);

function binDir(files: Record<string, Buffer>) {
  const dir = mkdtempSync(path.join(tmpdir(), 'pe-imports-'));
  roots.push(dir);
  for (const [name, bytes] of Object.entries(files)) writeFileSync(path.join(dir, name), bytes);
  return dir;
}

test('follows normal and delay-load imports case-insensitively', () => {
  const dir = binDir({
    'a.exe': buildPe(['KERNEL32.dll', 'Llama.dll'], ['Delayed.dll']),
    'llama.dll': buildPe(['kernel32.dll']),
    'delayed.dll': buildPe(['kernel32.dll']),
  });
  expect(verifyWindowsDllClosure(dir, 'a.exe', { isSystemDll })).toEqual([
    'delayed.dll',
    'llama.dll',
  ]);
});

test('accepts a CUDA server whose whole closure is bundled beside it', () => {
  const dir = binDir({
    'llama-server.exe': buildPe(['kernel32.dll', 'llama.dll']),
    'llama.dll': buildPe(['ggml.dll']),
    'ggml.dll': buildPe(['kernel32.dll']),
    // Loaded with LoadLibrary (GGML_BACKEND_DL), so it is passed as an extra root.
    'ggml-cuda.dll': buildPe(['cudart64_12.dll', 'cublas64_12.dll', 'nvcuda.dll', 'msvcp140.dll']),
    'cudart64_12.dll': buildPe(['kernel32.dll']),
    'cublas64_12.dll': buildPe(['cublasLt64_12.dll']),
    'cublasLt64_12.dll': buildPe(['kernel32.dll']),
  });
  expect(
    verifyWindowsDllClosure(dir, 'llama-server.exe', {
      isSystemDll,
      extraRoots: ['ggml-cuda.dll'],
    }),
  ).toEqual([
    'cublas64_12.dll',
    'cublaslt64_12.dll',
    'cudart64_12.dll',
    'ggml-cuda.dll',
    'ggml.dll',
    'llama.dll',
  ]);
});

test('rejects a server that would need CUDA runtime DLLs from PATH', () => {
  const dir = binDir({
    'llama-server.exe': buildPe(['ggml-cuda.dll']),
    'ggml-cuda.dll': buildPe(['cudart64_12.dll', 'cublas64_12.dll', 'nvcuda.dll']),
  });
  const check = () => verifyWindowsDllClosure(dir, 'llama-server.exe', { isSystemDll });
  expect(check).toThrow(/cudart64_12\.dll \(needed by ggml-cuda\.dll\)/);
  expect(check).toThrow(/cublas64_12\.dll \(needed by ggml-cuda\.dll\)/);
  expect(check).not.toThrow(/nvcuda/);
});
