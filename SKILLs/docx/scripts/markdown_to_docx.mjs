#!/usr/bin/env node
/**
 * Minimal, self-contained Markdown to DOCX converter for the bundled DOCX Skill.
 *
 * This is deliberately limited to new, simple documents. It avoids an external
 * converter and any runtime package resolution so it continues to work in the
 * packaged app with its managed Electron Node runtime.
 */
import { deflateRawSync } from 'node:zlib';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const usage = () => {
  console.error('Usage: markdown_to_docx.mjs <input.md> <output.docx>');
  process.exitCode = 1;
};

const xml = value =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

const crc32 = buffer => {
  let value = 0xffffffff;
  for (const byte of buffer) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
};

const u16 = value => {
  const output = Buffer.alloc(2);
  output.writeUInt16LE(value, 0);
  return output;
};
const u32 = value => {
  const output = Buffer.alloc(4);
  output.writeUInt32LE(value >>> 0, 0);
  return output;
};

function createZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const filename = Buffer.from(name, 'utf8');
    const source = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const compressed = deflateRawSync(source);
    const checksum = crc32(source);
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0x0800), u16(8), u16(0), u16(0),
      u32(checksum), u32(compressed.length), u32(source.length), u16(filename.length), u16(0),
      filename, compressed,
    ]);
    locals.push(local);
    centrals.push(Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(8), u16(0), u16(0),
      u32(checksum), u32(compressed.length), u32(source.length), u16(filename.length),
      u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), filename,
    ]));
    offset += local.length;
  }
  const central = Buffer.concat(centrals);
  return Buffer.concat([
    ...locals,
    central,
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(central.length), u32(offset), u16(0),
  ]);
}

function runs(text) {
  const parts = [];
  const literal = value =>
    String(value)
      .split('\n')
      .map((line, index) => `${index ? '<w:br/>' : ''}<w:t xml:space="preserve">${xml(line)}</w:t>`)
      .join('');
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*]+\*|_[^_]+_)/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > cursor) parts.push(`<w:r>${literal(text.slice(cursor, match.index))}</w:r>`);
    const token = match[0];
    const bold = token.startsWith('**') || token.startsWith('__');
    const italic = !bold && (token.startsWith('*') || token.startsWith('_'));
    const code = token.startsWith('`');
    const value = token.slice(bold ? 2 : 1, bold ? -2 : -1);
    const properties = `${bold ? '<w:b/>' : ''}${italic ? '<w:i/>' : ''}${code ? '<w:rStyle w:val="CodeChar"/>' : ''}`;
    parts.push(`<w:r><w:rPr>${properties}</w:rPr>${literal(value)}</w:r>`);
    cursor = match.index + token.length;
  }
  if (cursor < text.length || parts.length === 0) parts.push(`<w:r>${literal(text.slice(cursor))}</w:r>`);
  return parts.join('');
}

const paragraph = (text, style = null, numbering = null) =>
  `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${numbering ? `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numbering}"/></w:numPr>` : ''}</w:pPr>${runs(text)}</w:p>`;

function table(rows) {
  const cells = row => row.map(cell => `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>${paragraph(cell.trim())}</w:tc>`).join('');
  return `<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr>${rows.map(row => `<w:tr>${cells(row)}</w:tr>`).join('')}</w:tbl>`;
}

function documentXml(markdown) {
  const lines = markdown.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n').split('\n');
  const body = [];
  let codeLines = null;
  const isBlockBoundary = candidateIndex => {
    const candidate = lines[candidateIndex];
    if (!candidate || !candidate.trim()) return true;
    if (/^```/.test(candidate) || /^(#{1,6})\s+/.test(candidate)) return true;
    if (/^\s*[-*_]{3,}\s*$/.test(candidate)) return true;
    if (/^\s*[-*+]\s+/.test(candidate) || /^\s*\d+[.)]\s+/.test(candidate)) return true;
    if (/^>\s?/.test(candidate)) return true;
    return candidate.includes('|') &&
      candidateIndex + 1 < lines.length &&
      /^\s*\|?\s*:?-{3,}/.test(lines[candidateIndex + 1]);
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith('```')) {
      if (codeLines) {
        body.push(paragraph(codeLines.join('\n'), 'Code'));
        codeLines = null;
      } else codeLines = [];
      continue;
    }
    if (codeLines) { codeLines.push(line); continue; }
    if (!line.trim()) continue;
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) { body.push(paragraph(heading[2], `Heading${heading[1].length}`)); continue; }
    if (/^[-*_]{3,}\s*$/.test(line)) { body.push('<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr></w:pPr></w:p>'); continue; }
    const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
    if (unordered) { body.push(paragraph(unordered[1], null, 1)); continue; }
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (ordered) { body.push(paragraph(ordered[1], null, 2)); continue; }
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) { body.push(paragraph(quote[1], 'Quote')); continue; }
    if (line.includes('|') && index + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1])) {
      const tableLines = [line];
      let nextLine = index + 2;
      while (nextLine < lines.length && lines[nextLine].includes('|') && lines[nextLine].trim()) {
        tableLines.push(lines[nextLine]);
        nextLine += 1;
      }
      const rows = tableLines.map(value => value.replace(/^\||\|$/g, '').split('|'));
      body.push(table(rows));
      index = nextLine - 1;
      continue;
    }
    const paragraphLines = [line];
    let nextLine = index + 1;
    while (nextLine < lines.length && !isBlockBoundary(nextLine)) {
      paragraphLines.push(lines[nextLine]);
      nextLine += 1;
    }
    body.push(paragraph(paragraphLines.join(' ')));
    index = nextLine - 1;
  }
  if (codeLines) body.push(paragraph(codeLines.join('\n'), 'Code'));
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
}

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos" w:eastAsia="Microsoft YaHei"/><w:sz w:val="22"/></w:rPr></w:style>${[1,2,3,4,5,6].map(level => `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="${40 - level * 3}"/></w:rPr></w:style>`).join('')}<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720"/></w:pPr><w:rPr><w:i/><w:color w:val="666666"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F3F4F6"/><w:ind w:left="360" w:right="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr></w:style><w:style w:type="character" w:styleId="CodeChar"><w:name w:val="CodeChar"/><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr></w:style></w:styles>`;
const numberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;

async function main() {
  const [, , input, output] = process.argv;
  if (!input || !output) return usage();
  const markdown = await readFile(input, 'utf8');
  await mkdir(dirname(output), { recursive: true });
  const archive = createZip([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
    ['word/document.xml', documentXml(markdown)],
    ['word/styles.xml', stylesXml],
    ['word/numbering.xml', numberingXml],
    ['word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>'],
  ]);
  await writeFile(output, archive);
  console.log(`Created DOCX: ${output}`);
}

main().catch(error => {
  console.error(`DOCX conversion failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
