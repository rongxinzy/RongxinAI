#!/usr/bin/env bash
# Render the first DOCX page to a real PNG for the controlled shortcut gate.
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: $(basename "$0") <input.docx> <output.png>" >&2
  exit 2
fi

input="$1"
output="$2"
if [ ! -f "$input" ]; then
  echo "DOCX input does not exist: $input" >&2
  exit 1
fi
if [[ "$output" != *.png ]]; then
  echo "Preview output must end with .png: $output" >&2
  exit 2
fi

soffice_bin="${SOFFICE_BIN:-$(command -v soffice || true)}"
if [ -z "$soffice_bin" ]; then
  for candidate in /Applications/LibreOffice.app/Contents/MacOS/soffice /usr/lib/libreoffice/program/soffice; do
    [ -x "$candidate" ] && soffice_bin="$candidate" && break
  done
fi
if [ -z "$soffice_bin" ]; then
  echo "LibreOffice/soffice is required to render DOCX previews." >&2
  exit 1
fi
pdftoppm_bin="$(command -v pdftoppm || true)"
if [ -z "$pdftoppm_bin" ]; then
  echo "pdftoppm is required to render the PDF preview page." >&2
  exit 1
fi

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT
# LibreOffice otherwise initializes its profile below the caller's home
# directory. That is both shared mutable state and unavailable in sandboxed
# execution, so give every render an isolated, disposable profile.
profile_dir="$tmpdir/libreoffice-profile"
mkdir -p "$profile_dir"
"$soffice_bin" "-env:UserInstallation=file://$profile_dir" --headless --convert-to pdf --outdir "$tmpdir" "$input" >/dev/null
pdf="$tmpdir/$(basename "${input%.*}").pdf"
if [ ! -s "$pdf" ]; then
  echo "LibreOffice did not produce a PDF preview." >&2
  exit 1
fi
mkdir -p "$(dirname "$output")"
"$pdftoppm_bin" -png -r 150 -f 1 -singlefile "$pdf" "${output%.png}" >/dev/null
if [ ! -s "$output" ]; then
  echo "Preview renderer did not produce a PNG." >&2
  exit 1
fi
echo "Rendered DOCX preview: $output"
