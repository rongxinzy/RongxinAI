#!/usr/bin/env python3
"""Extract PDF text by page or render selected pages for local OCR.

Runs on the packaged Skill Python layer, which already ships pypdfium2 and
Pillow for the PDF Skill, so scanned-PDF OCR adds no dependency.

    python pdf-pages.py --input doc.pdf --pages 1-5 --dpi 200 --out <dir>

Prints one rendered PNG path per line on stdout. Refuses to rasterize more than
--max-pages (default 20) or more than --max-megapixels (default 40) in total so a
hostile or huge document cannot exhaust memory.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from contextlib import closing


def parse_pages(spec: str, page_count: int) -> list[int]:
    """Parse '1-5,9' into zero-based page indexes, clamped to the document."""
    if not spec or spec == "all":
        return list(range(page_count))
    selected: dict[int, None] = {}
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            start_text, _, end_text = part.partition("-")
            start = int(start_text or 1)
            end = int(end_text or page_count)
        else:
            start = end = int(part)
        for page in range(max(1, start), min(page_count, end) + 1):
            selected[page - 1] = None
    return list(selected)


def extract_text(document, indexes: list[int], max_characters: int) -> dict:
    pages: list[dict] = []
    remaining = max_characters
    truncated = False
    for index in indexes:
        with closing(document[index]) as page:
            with closing(page.get_textpage()) as textpage:
                text = textpage.get_text_bounded().replace("\r\n", "\n").strip()
        if not re.search(r"[^\s\ufffd\x00]", text):
            text = ""
        pages.append({"page": index + 1, "text": text[:remaining]})
        truncated = len(text) > remaining
        remaining -= len(text)
        if remaining <= 0:
            break
    return {"pages": pages, "truncated": truncated or len(pages) < len(indexes)}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--pages", default="all")
    parser.add_argument("--dpi", type=int, default=200)
    parser.add_argument("--out")
    parser.add_argument("--max-pages", type=int, default=20)
    parser.add_argument("--max-megapixels", type=float, default=40.0)
    parser.add_argument("--text", action="store_true")
    parser.add_argument("--max-characters", type=int, default=30000)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    if not args.text and not args.out:
        parser.error("--out is required when rendering PDF pages")

    import pypdfium2 as pdfium

    document = pdfium.PdfDocument(args.input)
    try:
        page_count = len(document)
        selected = parse_pages(args.pages, page_count)
        pages = selected[: args.max_pages]
        if args.text:
            payload = extract_text(document, pages, args.max_characters)
            payload["pageCount"] = page_count
            payload["truncated"] = payload["truncated"] or len(pages) < len(selected)
            print(json.dumps(payload, ensure_ascii=False))
            return 0

        os.makedirs(args.out, exist_ok=True)

        scale = args.dpi / 72
        rendered: list[dict] = []
        megapixels = 0.0
        for index in pages:
            page = document[index]
            width, height = page.get_size()
            pixels = (width * scale) * (height * scale)
            if megapixels + pixels > args.max_megapixels * 1_000_000:
                break
            megapixels += pixels
            bitmap = page.render(scale=scale)
            image = bitmap.to_pil()
            output = os.path.join(args.out, f"page-{index + 1:04d}.png")
            image.save(output, format="PNG")
            rendered.append({"page": index + 1, "path": output, "width": image.width, "height": image.height})
            page.close()

        payload = {
            "pageCount": page_count,
            "renderedCount": len(rendered),
            "truncated": len(rendered) < len(selected),
            "pages": rendered,
        }
        if args.json:
            print(json.dumps(payload, ensure_ascii=False))
        else:
            for entry in rendered:
                print(entry["path"])
        return 0
    finally:
        document.close()


if __name__ == "__main__":
    sys.exit(main())
