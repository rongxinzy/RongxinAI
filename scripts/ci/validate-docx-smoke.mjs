import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

const docxPath = process.argv[2];
if (!docxPath) {
  console.error('Usage: validate-docx-smoke.mjs <document.docx>');
  process.exit(1);
}

try {
  const archive = readFileSync(docxPath);
  if (archive.length < 4 || archive.readUInt32LE(0) !== 0x04034b50) {
    throw new Error('document is not a ZIP archive');
  }

  let offset = 0;
  let documentXml = '';
  while (offset + 30 <= archive.length && archive.readUInt32LE(offset) === 0x04034b50) {
    const compressionMethod = archive.readUInt16LE(offset + 8);
    const compressedSize = archive.readUInt32LE(offset + 18);
    const filenameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    const dataStart = offset + 30 + filenameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > archive.length) throw new Error('document contains a truncated ZIP entry');

    const filename = archive.subarray(offset + 30, offset + 30 + filenameLength).toString();
    if (filename === 'word/document.xml') {
      const compressed = archive.subarray(dataStart, dataEnd);
      if (compressionMethod === 0) documentXml = compressed.toString();
      else if (compressionMethod === 8) documentXml = inflateRawSync(compressed).toString();
      else throw new Error(`word/document.xml uses unsupported compression ${compressionMethod}`);
      break;
    }
    offset = dataEnd;
  }

  if (!documentXml.includes('Heading1')) {
    throw new Error('word/document.xml is missing the Heading1 style');
  }
  console.log(`Validated DOCX: ${docxPath}`);
} catch (error) {
  console.error(
    `DOCX validation failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
