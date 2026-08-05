#!/usr/bin/env node
/** Extract readable text from the XML parts of a DOCX without external packages. */
import { readFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';

const usage = () => {
  console.error('Usage: docx_to_text.mjs <file.docx>');
  process.exitCode = 1;
};

function readZipEntries(buffer) {
  const entries = new Map();
  let offset = 0;
  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = buffer.subarray(nameStart, nameStart + nameLength).toString('utf8');
    const contentStart = nameStart + nameLength + extraLength;
    const compressed = buffer.subarray(contentStart, contentStart + compressedSize);
    if (method === 0) entries.set(name, compressed);
    else if (method === 8) entries.set(name, inflateRawSync(compressed));
    else throw new Error(`Unsupported DOCX ZIP compression method: ${method}`);
    offset = contentStart + compressedSize;
  }
  return entries;
}

function decodeXml(value) {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

function textFromXml(value) {
  return decodeXml(
    value
      .replace(/<w:tab[^>]*\/>/g, '\t')
      .replace(/<w:br[^>]*\/>/g, '\n')
      .replace(/<w:cr[^>]*\/>/g, '\n')
      .replace(/<\/w:(?:p|tr)>/g, '\n')
      .replace(/<\/w:tc>/g, '\t')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function main() {
  const [, , input] = process.argv;
  if (!input) return usage();
  const entries = readZipEntries(await readFile(input));
  const names = [...entries.keys()].filter(name =>
    /^word\/(?:document|header\d+|footer\d+|footnotes|endnotes)\.xml$/.test(name),
  );
  const ordered = names.sort((a, b) => (a === 'word/document.xml' ? -1 : b === 'word/document.xml' ? 1 : a.localeCompare(b)));
  const content = ordered.map(name => textFromXml(entries.get(name).toString('utf8'))).filter(Boolean).join('\n\n');
  process.stdout.write(`${content}\n`);
}

main().catch(error => {
  console.error(`DOCX preview failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
