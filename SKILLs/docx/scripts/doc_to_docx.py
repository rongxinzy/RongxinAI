#!/usr/bin/env python3
"""Convert .doc to .docx using LibreOffice."""

import os
import shutil
import subprocess
import sys
from pathlib import Path


def find_soffice() -> str | None:
    found = shutil.which("soffice")
    if found:
        return found

    common_paths = [
        Path("/Applications/LibreOffice.app/Contents/MacOS/soffice"),
        Path("/usr/bin/soffice"),
        Path("/usr/local/bin/soffice"),
        Path("/usr/lib/libreoffice/program/soffice"),
        Path("/snap/bin/libreoffice"),
        Path("/opt/libreoffice/program/soffice"),
        Path("C:/Program Files/LibreOffice/program/soffice.exe"),
        Path("C:/Program Files (x86)/LibreOffice/program/soffice.exe"),
    ]
    for candidate in common_paths:
        if candidate.is_file():
            return str(candidate)
    return None


def usage() -> None:
    name = Path(sys.argv[0]).name
    print(f"Usage: {name} <file.doc> [output_directory]")
    print("Convert .doc to .docx using LibreOffice.")


def main() -> int:
    if len(sys.argv) < 2:
        usage()
        return 1

    input_path = Path(sys.argv[1])
    out_dir = Path(sys.argv[2]) if len(sys.argv) >= 3 else Path(".")

    if not input_path.is_file():
        print(f"Error: File not found: {input_path}")
        return 1

    soffice = find_soffice()
    if not soffice:
        print("Error: soffice (LibreOffice) is required for .doc conversion but not found.")
        if sys.platform == "darwin":
            print("Install LibreOffice: brew install --cask libreoffice")
        elif os.name == "nt":
            print("Install LibreOffice: winget install TheDocumentFoundation.LibreOffice")
        else:
            print("Install LibreOffice: sudo apt-get install libreoffice-core")
        return 1

    out_dir.mkdir(parents=True, exist_ok=True)
    stem = input_path.name[:-4] if input_path.name.lower().endswith(".doc") else input_path.stem
    print(f"Converting: {input_path} -> {out_dir / f'{stem}.docx'}")

    result = subprocess.run(
        [soffice, "--headless", "--convert-to", "docx", "--outdir", str(out_dir), str(input_path)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    output_path = out_dir / f"{stem}.docx"
    if result.returncode != 0 or not output_path.is_file():
        print(f"Error: Conversion failed. Output file not created: {output_path}")
        return 1

    print(f"Success: {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
