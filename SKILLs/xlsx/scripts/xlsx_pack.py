#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""
xlsx_pack.py — Pack a working directory back into a valid xlsx file.

Usage:
    python3 xlsx_pack.py <source_dir> <output.xlsx>

Requirements:
    - source_dir must contain [Content_Types].xml at its root

The working directory is archived as supplied, without a validation pass.
"""

import sys
import os
import zipfile


def pack(source_dir: str, xlsx_path: str) -> None:
    if not os.path.isdir(source_dir):
        print(f"ERROR: Directory not found: {source_dir}", file=sys.stderr)
        sys.exit(1)

    content_types = os.path.join(source_dir, "[Content_Types].xml")
    if not os.path.isfile(content_types):
        print(
            f"ERROR: Missing [Content_Types].xml in {source_dir}\n"
            "  This file is required at the root of every valid xlsx package.",
            file=sys.stderr,
        )
        sys.exit(1)

    # Count files to pack
    file_count = sum(len(files) for _, _, files in os.walk(source_dir))

    with zipfile.ZipFile(xlsx_path, "w", compression=zipfile.ZIP_DEFLATED) as z:
        for dirpath, _, filenames in os.walk(source_dir):
            for fname in filenames:
                fpath = os.path.join(dirpath, fname)
                arcname = os.path.relpath(fpath, source_dir)
                z.write(fpath, arcname)

    size = os.path.getsize(xlsx_path)
    print(f"Packed {file_count} files → '{xlsx_path}' ({size:,} bytes)")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: xlsx_pack.py <source_dir> <output.xlsx>")
        sys.exit(1)
    pack(sys.argv[1], sys.argv[2])
