#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $(basename "$0") <file.docx>"
  echo "Preview DOCX content as plain text."
  exit 1
}

if [ $# -lt 1 ]; then
  usage
fi

INPUT="$1"

if [ ! -f "$INPUT" ]; then
  echo "Error: File not found: $INPUT"
  exit 1
fi

FILE_SIZE=$(du -h "$INPUT" | cut -f1)
echo "=== DOCX Preview: $(basename "$INPUT") ==="
echo "File size: $FILE_SIZE"

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
if [ -n "${ZHIYUAN_ELECTRON_PATH:-}" ] && [ -x "$ZHIYUAN_ELECTRON_PATH" ]; then
  CONTENT=$(ELECTRON_RUN_AS_NODE=1 "$ZHIYUAN_ELECTRON_PATH" "$SCRIPT_DIR/docx_to_text.mjs" "$INPUT")
else
  # CLI-only fallback for environments without the managed Electron runtime.
  CONTENT=$(unzip -p "$INPUT" word/document.xml 2>/dev/null | \
    sed -E 's/<w:tab[^>]*>/\t/g; s#</w:p>#\n#g; s/<[^>]+>//g; s/&amp;/\&/g; s/&lt;/</g; s/&gt;/>/g; s/&quot;/"/g; s/&apos;/'"'"'/g' | \
    sed '/^[[:space:]]*$/d')
fi
WORD_COUNT=$(echo "$CONTENT" | wc -w | tr -d ' ')
EST_PAGES=$(( (WORD_COUNT + 249) / 250 ))
echo "Word count: $WORD_COUNT"
echo "Estimated pages: $EST_PAGES"
echo "---"
echo "$CONTENT"
