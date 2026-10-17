'use strict';

// Static Windows DLL dependency check for the bundled llama.cpp runtime.
//
// The CUDA edition must load from its own directory on a machine that only has
// the NVIDIA driver installed: no CUDA toolkit, nothing on PATH. Running the
// server on a GPU-less CI runner cannot prove that (the driver DLL is missing
// there), so we read the PE import tables instead and require every imported
// DLL to be either bundled beside the executable, a Windows system DLL, or the
// NVIDIA driver itself (nvcuda.dll ships with the driver, never with us).

const fs = require('node:fs');
const path = require('node:path');

const IMPORT_DIRECTORY = 1;
const DELAY_IMPORT_DIRECTORY = 13;
/** Supplied by the NVIDIA display driver; bundling it would be wrong. */
const NVIDIA_DRIVER_DLLS = new Set(['nvcuda.dll', 'nvml.dll']);
const API_SET_DLL = /^(api-ms-win-|ext-ms-)/i;

function readCString(buffer, offset) {
  const end = buffer.indexOf(0, offset);
  if (offset < 0 || end < 0) throw new Error('Invalid PE string offset');
  return buffer.toString('latin1', offset, end);
}

function readPeImports(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.length < 64 || buffer.readUInt16LE(0) !== 0x5a4d) {
    throw new Error(`${filePath} is not a PE file`);
  }
  const pe = buffer.readUInt32LE(60);
  if (buffer.readUInt32LE(pe) !== 0x4550) throw new Error(`${filePath} has no PE header`);
  const sectionCount = buffer.readUInt16LE(pe + 6);
  const optionalSize = buffer.readUInt16LE(pe + 20);
  const optional = pe + 24;
  const magic = buffer.readUInt16LE(optional);
  if (magic !== 0x20b && magic !== 0x10b) throw new Error(`${filePath} has unknown PE magic`);
  const dataDirectories = optional + (magic === 0x20b ? 112 : 96);
  const sections = [];
  for (let index = 0; index < sectionCount; index += 1) {
    const header = optional + optionalSize + index * 40;
    sections.push({
      virtualAddress: buffer.readUInt32LE(header + 12),
      virtualSize: Math.max(buffer.readUInt32LE(header + 8), buffer.readUInt32LE(header + 16)),
      rawPointer: buffer.readUInt32LE(header + 20),
    });
  }
  const toOffset = rva => {
    const section = sections.find(
      entry => rva >= entry.virtualAddress && rva < entry.virtualAddress + entry.virtualSize,
    );
    if (!section) throw new Error(`${filePath}: RVA 0x${rva.toString(16)} is outside sections`);
    return rva - section.virtualAddress + section.rawPointer;
  };
  const names = new Set();
  const readDirectory = (directoryIndex, descriptorSize, nameField) => {
    const rva = buffer.readUInt32LE(dataDirectories + directoryIndex * 8);
    if (rva === 0) return;
    for (let offset = toOffset(rva); ; offset += descriptorSize) {
      const nameRva = buffer.readUInt32LE(offset + nameField);
      if (nameRva === 0) break;
      names.add(readCString(buffer, toOffset(nameRva)).toLowerCase());
    }
  };
  readDirectory(IMPORT_DIRECTORY, 20, 12);
  readDirectory(DELAY_IMPORT_DIRECTORY, 32, 4);
  return [...names].sort();
}

function defaultIsSystemDll(name) {
  if (API_SET_DLL.test(name)) return true;
  const systemRoot = process.env.SystemRoot || process.env.windir;
  if (!systemRoot) return false;
  return fs.existsSync(path.join(systemRoot, 'System32', name));
}

/**
 * Walks the import closure of `executable` inside `binDir`. Returns the list of
 * bundled DLLs it loads; throws listing every DLL that would have to come from
 * PATH (i.e. is neither bundled, a system DLL, nor the NVIDIA driver).
 */
function verifyWindowsDllClosure(
  binDir,
  executable,
  { isSystemDll = defaultIsSystemDll, extraRoots = [] } = {},
) {
  const bundled = new Map(
    fs
      .readdirSync(binDir)
      .filter(name => /\.(dll|exe)$/i.test(name))
      .map(name => [name.toLowerCase(), path.join(binDir, name)]),
  );
  const missing = new Map();
  const loaded = new Set();
  // extraRoots covers modules loaded with LoadLibrary (GGML_BACKEND_DL backends).
  const queue = [executable, ...extraRoots].map(name => name.toLowerCase());
  while (queue.length > 0) {
    const current = queue.shift();
    if (loaded.has(current)) continue;
    loaded.add(current);
    for (const dependency of readPeImports(bundled.get(current))) {
      if (bundled.has(dependency)) {
        queue.push(dependency);
      } else if (!NVIDIA_DRIVER_DLLS.has(dependency) && !isSystemDll(dependency)) {
        missing.set(dependency, current);
      }
    }
  }
  if (missing.size > 0) {
    const detail = [...missing].map(([dll, by]) => `${dll} (needed by ${by})`).join(', ');
    throw new Error(`DLLs not bundled beside ${executable}: ${detail}`);
  }
  loaded.delete(executable.toLowerCase());
  return [...loaded].sort();
}

module.exports = { verifyWindowsDllClosure };
