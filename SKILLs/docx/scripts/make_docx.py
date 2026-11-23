#!/usr/bin/env python3
"""Create a DOCX with the Python standard library only.

This is the fallback for runtimes that have no Node, python-docx, pandoc or
LibreOffice. It supports a small Markdown subset: ATX headings, bullet lines,
paragraphs, and ``**bold**`` runs. It does not do tracked changes, comments,
tables, images, or pagination-aware layout; use the full toolchain when the
runtime provides it.

Usage:
    python3 scripts/make_docx.py input.md output.docx
    python3 scripts/make_docx.py - output.docx   # read stdin
"""

from __future__ import annotations

import argparse
import re
import sys
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types"

_CONTENT_TYPES = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="{CT_NS}">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>
"""

_ROOT_RELS = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="{REL_NS}">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>
"""

_DOCUMENT_RELS = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="{REL_NS}">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>
"""

_STYLES = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="{WORD_NS}">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:rPr><w:sz w:val="22"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:qFormat/>
    <w:pPr><w:outlineLvl w:val="0"/><w:spacing w:before="240" w:after="120"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="32"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:qFormat/>
    <w:pPr><w:outlineLvl w:val="1"/><w:spacing w:before="200" w:after="100"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="28"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:qFormat/>
    <w:pPr><w:outlineLvl w:val="2"/><w:spacing w:before="160" w:after="80"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="24"/></w:rPr>
  </w:style>
</w:styles>
"""

_SECT_PR = (
    "<w:sectPr>"
    '<w:pgSz w:w="11906" w:h="16838"/>'
    '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" '
    'w:header="708" w:footer="708" w:gutter="0"/>'
    "</w:sectPr>"
)

_BOLD_RE = re.compile(r"(\*\*.+?\*\*)")


def _runs(text: str, *, bold: bool = False) -> str:
    parts: list[str] = []
    for piece in _BOLD_RE.split(text):
        if not piece:
            continue
        is_bold = bold or (piece.startswith("**") and piece.endswith("**") and len(piece) >= 4)
        value = piece[2:-2] if piece.startswith("**") and piece.endswith("**") and len(piece) >= 4 else piece
        props = "<w:rPr><w:b/></w:rPr>" if is_bold else ""
        parts.append(f'<w:r>{props}<w:t xml:space="preserve">{escape(value)}</w:t></w:r>')
    return "".join(parts)


def _paragraph(text: str, style: str | None = None, *, prefix: str = "") -> str:
    props = f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style else ""
    return f"<w:p>{props}{_runs(prefix + text)}</w:p>"


def _body(markdown: str) -> str:
    paragraphs: list[str] = []
    for raw in markdown.splitlines():
        line = raw.rstrip()
        stripped = line.strip()
        if not stripped:
            continue
        heading = re.match(r"^(#{1,3})\s+(.*)$", stripped)
        if heading:
            level = len(heading.group(1))
            paragraphs.append(_paragraph(heading.group(2), f"Heading{level}"))
        elif stripped.startswith(("- ", "* ")):
            paragraphs.append(_paragraph(stripped[2:], prefix="• "))
        else:
            paragraphs.append(_paragraph(stripped))
    if not paragraphs:
        paragraphs.append("<w:p/>")
    return "".join(paragraphs)


def _document(markdown: str) -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        f'<w:document xmlns:w="{WORD_NS}"><w:body>{_body(markdown)}{_SECT_PR}</w:body></w:document>'
    )


def write_docx(markdown: str, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", _CONTENT_TYPES)
        archive.writestr("_rels/.rels", _ROOT_RELS)
        archive.writestr("word/document.xml", _document(markdown))
        archive.writestr("word/_rels/document.xml.rels", _DOCUMENT_RELS)
        archive.writestr("word/styles.xml", _STYLES)


def verify_docx(output: Path) -> None:
    """Fail loudly when the archive is not a structurally complete DOCX."""
    import xml.etree.ElementTree as ET

    with zipfile.ZipFile(output) as archive:
        broken = archive.testzip()
        if broken is not None:
            raise ValueError(f"corrupt DOCX member: {broken}")
        for member in ("[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/styles.xml"):
            if member not in archive.namelist():
                raise ValueError(f"missing DOCX member: {member}")
        ET.fromstring(archive.read("word/document.xml"))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Create a DOCX with the Python standard library")
    parser.add_argument("input", help="Markdown/text input path, or - for stdin")
    parser.add_argument("output", help="DOCX output path")
    args = parser.parse_args(argv)
    markdown = sys.stdin.read() if args.input == "-" else Path(args.input).read_text(encoding="utf-8")
    destination = Path(args.output)
    write_docx(markdown, destination)
    verify_docx(destination)
    print(destination)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
