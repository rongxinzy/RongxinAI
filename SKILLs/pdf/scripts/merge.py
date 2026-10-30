#!/usr/bin/env python3
"""
merge.py — Merge cover.pdf + body.pdf → final.pdf and print output metadata.

Usage:
    python3 merge.py --cover cover.pdf --body body.pdf --out final.pdf
    python3 merge.py --cover cover.pdf --body body.pdf --out final.pdf --title "My Report"

Exit codes: 0 success, 1 bad args/missing file, 2 missing dep, 3 merge error
"""

import argparse
import json
import os
import sys

try:
    from pypdf import PdfWriter, PdfReader
except ImportError:
    print("Missing pypdf. Run this script through make.sh or: uv run --with pypdf python merge.py ...", file=sys.stderr)
    raise SystemExit(2)


def merge(cover_path: str, body_path: str, out_path: str, title: str = "") -> dict:
    writer = PdfWriter()
    page_counts = []

    for fpath, label in [(cover_path, "cover"), (body_path, "body")]:
        if not os.path.exists(fpath):
            return {"status": "error", "error": f"{label} file not found: {fpath}"}
        reader = PdfReader(fpath)
        page_counts.append(len(reader.pages))
        for page in reader.pages:
            writer.add_page(page)

    # Set PDF metadata
    if title:
        writer.add_metadata({"/Title": title})

    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, "wb") as f:
        writer.write(f)

    size_kb = os.path.getsize(out_path) // 1024
    total_pages = len(writer.pages)

    cover_pages, body_pages = page_counts

    report = {
        "status":       "ok",
        "out":          out_path,
        "total_pages":  total_pages,
        "cover_pages":  cover_pages,
        "body_pages":   body_pages,
        "size_kb":      size_kb,
    }
    return report


def main():
    parser = argparse.ArgumentParser(description="Merge cover + body PDFs")
    parser.add_argument("--cover", required=True)
    parser.add_argument("--body",  required=True)
    parser.add_argument("--out",   required=True)
    parser.add_argument("--title", default="")
    args = parser.parse_args()

    result = merge(args.cover, args.body, args.out, args.title)

    if result["status"] == "error":
        print(json.dumps(result), file=sys.stderr)
        sys.exit(3)

    print(json.dumps(result))


if __name__ == "__main__":
    main()
