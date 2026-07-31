#!/usr/bin/env bash
# Create a simple, portable DOCX from Markdown when the full OpenXML toolchain
# is not installed. Complex editing and template operations still require .NET.
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: $(basename "$0") <input.md> <output.docx>" >&2
  exit 2
fi

input="$1"
output="$2"
if [ ! -f "$input" ]; then
  echo "Markdown input does not exist: $input" >&2
  exit 1
fi
if [[ "$output" != *.docx ]]; then
  echo "DOCX output must end with .docx: $output" >&2
  exit 2
fi

pandoc_bin="${PANDOC_BIN:-$(command -v pandoc || true)}"
if [ -z "$pandoc_bin" ]; then
  echo "Pandoc is required for the Markdown-to-DOCX fallback." >&2
  exit 1
fi

mkdir -p "$(dirname "$output")"
"$pandoc_bin" --from markdown --to docx --output "$output" "$input"
if [ ! -s "$output" ]; then
  echo "Pandoc did not produce a DOCX file." >&2
  exit 1
fi
echo "Created DOCX from Markdown: $output"
