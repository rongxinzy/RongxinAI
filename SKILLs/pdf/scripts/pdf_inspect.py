#!/usr/bin/env python3
"""Render every PDF page and write visual-QA evidence for the PDF Skill."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Render every PDF page, generate a contact sheet, and report low-content pages."
    )
    parser.add_argument("input", type=Path, help="PDF to inspect")
    parser.add_argument("-o", "--output", required=True, type=Path, help="Output directory")
    parser.add_argument("--scale", type=float, default=1.5, help="Render scale (default: 1.5)")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not args.input.is_file() or args.input.stat().st_size == 0:
        print(f"PDF input does not exist or is empty: {args.input}", file=sys.stderr)
        return 2
    if args.scale <= 0:
        print("--scale must be greater than zero", file=sys.stderr)
        return 2
    try:
        import pypdfium2 as pdfium
        from PIL import Image, ImageDraw, ImageStat
    except ImportError as error:
        print(
            "PDF visual inspection needs pypdfium2 and Pillow. Run with uv run --with pypdfium2 --with pillow.",
            file=sys.stderr,
        )
        print(error, file=sys.stderr)
        return 3

    args.output.mkdir(parents=True, exist_ok=True)
    document = pdfium.PdfDocument(str(args.input))
    page_images: list[Path] = []
    pages: list[dict[str, object]] = []
    try:
        for page_number in range(len(document)):
            page = document[page_number]
            image = page.render(scale=args.scale).to_pil().convert("RGB")
            output = args.output / f"page-{page_number + 1:03d}.png"
            image.save(output)
            gray = image.convert("L")
            stats = ImageStat.Stat(gray)
            average, variance = float(stats.mean[0]), float(stats.var[0])
            page_images.append(output)
            pages.append(
                {
                    "page": page_number + 1,
                    "path": output.name,
                    "width": image.width,
                    "height": image.height,
                    "mean_luminance": round(average, 2),
                    "luminance_variance": round(variance, 2),
                    "low_content": average > 252.0 and variance < 12.0,
                }
            )
            page.close()
    finally:
        document.close()
    if not page_images:
        print("PDF contains no renderable pages", file=sys.stderr)
        return 4

    thumbnail_width, margin, label_height, columns = 420, 24, 26, 2
    thumbnails: list[Image.Image] = []
    for image_path in page_images:
        with Image.open(image_path) as source:
            thumbnail = source.copy()
            thumbnail.thumbnail((thumbnail_width, 600))
            thumbnails.append(thumbnail)
    cell_height = max(image.height for image in thumbnails) + label_height
    rows = (len(thumbnails) + columns - 1) // columns
    sheet = Image.new(
        "RGB",
        (columns * thumbnail_width + (columns + 1) * margin, rows * cell_height + (rows + 1) * margin),
        "white",
    )
    draw = ImageDraw.Draw(sheet)
    for index, image in enumerate(thumbnails):
        row, column = divmod(index, columns)
        left = margin + column * (thumbnail_width + margin)
        top = margin + row * (cell_height + margin)
        sheet.paste(image, (left + (thumbnail_width - image.width) // 2, top))
        draw.text((left, top + image.height + 4), f"Page {index + 1}", fill="black")
    contact_sheet = args.output / "contact-sheet.png"
    sheet.save(contact_sheet)
    report = {
        "input": str(args.input.resolve()),
        "page_count": len(pages),
        "contact_sheet": contact_sheet.name,
        "low_content_pages": [page["page"] for page in pages if page["low_content"]],
        "pages": pages,
    }
    report_path = args.output / "inspection.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"Rendered {len(pages)} page(s): {contact_sheet}")
    print(f"Inspection report: {report_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
