#!/usr/bin/env python3
"""
cover.py — Generate cover.html from tokens.json.

Usage:
    python3 cover.py --tokens tokens.json --out cover.html

Reads tokens.json["cover_pattern"] and renders the matching HTML cover.
Cover fonts are loaded live via Google Fonts @import (no local caching).
Exit codes: 0 success, 1 bad args/missing file, 3 render error

Pattern rendering lives in cover_lib/ (split from this file); every
name stays re-exported here so `import cover` is unchanged.
"""

import argparse
import json
import sys

from cover_lib import (  # noqa: F401 — re-exports keep import cover stable
    PATTERNS,
    _base_css,
    _cross_hatch,
    _dot_grid,
    _gfonts_import,
    _pattern_atmospheric,
    _pattern_darkroom,
    _pattern_diagonal,
    _pattern_editorial,
    _pattern_frame,
    _pattern_fullbleed,
    _pattern_magazine,
    _pattern_minimal,
    _pattern_poster,
    _pattern_split,
    _pattern_stripe,
    _pattern_terminal,
    _pattern_typographic,
    render,
)


# ── CLI ───────────────────────────────────────────────────────────────────────
def main():
    """CLI entry point."""
    parser = argparse.ArgumentParser(description="Render cover HTML from tokens.json")
    parser.add_argument("--tokens", default="tokens.json")
    parser.add_argument("--out",    default="cover.html")
    parser.add_argument("--subtitle", default="", help="Optional subtitle override")
    args = parser.parse_args()

    try:
        with open(args.tokens, encoding="utf-8") as f:
            tokens = json.load(f)
    except FileNotFoundError:
        print(json.dumps({"status": "error", "error": f"tokens file not found: {args.tokens}"}),
              file=sys.stderr)
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(json.dumps({"status": "error", "error": f"invalid JSON: {e}"}), file=sys.stderr)
        sys.exit(1)

    if args.subtitle:
        tokens["subtitle"] = args.subtitle

    html = render(tokens)

    try:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(html)
    except OSError as e:
        print(json.dumps({"status": "error", "error": str(e)}), file=sys.stderr)
        sys.exit(3)

    print(json.dumps({
        "status":  "ok",
        "out":     args.out,
        "pattern": tokens.get("cover_pattern"),
    }))


if __name__ == "__main__":
    main()
