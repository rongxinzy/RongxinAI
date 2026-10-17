#!/usr/bin/env python3
"""
render_body.py — Build the inner-page PDF from tokens.json + content.json.

Usage:
    python3 render_body.py --tokens tokens.json --content content.json --out body.pdf

Block types:
    h1 h2 h3           Headings (h1 adds a full-width accent rule below)
    body               Justified prose paragraph
    bullet             Bullet list item (• prefix)
    numbered           Auto-numbered list item (resets when interrupted)
    callout            Highlighted insight box with left accent bar
    table              Data table with accent header + alternating rows
    image              Inline image from file path
    figure             Image with auto-numbered "Figure N:" caption
    code               Monospace code block with accent left border
    math               Display math formula via matplotlib mathtext
    chart              Bar / line / pie chart rendered via matplotlib
    flowchart          Process diagram rendered via matplotlib
    bibliography       Numbered reference list
    divider            Full-width accent rule
    caption            Small muted text (e.g., under a figure)
    pagebreak          Force a new page
    spacer             Vertical whitespace (pt field, default 12)

Exit codes: 0 success, 1 bad args/missing file, 2 missing dep, 3 render error

Implementation lives in sibling modules (issue #1069 split):
    body_flowables.py  Custom flowables + page template (BeautifulDoc, …)
    body_styles.py     register_fonts + make_styles
    body_png.py        Matplotlib PNG renderers (math / chart / flowchart)
    body_blocks.py     Per-block renderers + build_story
This file re-exports the full former surface so existing imports keep working.
"""

import argparse
import json
import os
import sys
try:
    from reportlab.lib.pagesizes import A4

    from body_flowables import CalloutBox, BibliographyItem, BeautifulDoc
    from body_styles import register_fonts, make_styles
    from body_png import (
        _image_from_bytes, _render_math_png, _render_chart_png,
        _render_flowchart_png,
    )
    from body_blocks import (
        _divider,
        _add_heading, _add_body, _add_bullet, _add_numbered, _add_callout,
        _add_table, _add_image, _add_figure, _add_code, _add_math,
        _add_chart, _add_flowchart, _add_bibliography,
        _RESETS_NUMBERED, build_story,
    )
except ImportError:
    print("Missing reportlab. Run through make.sh or: uv run --with reportlab python render_body.py ...", file=sys.stderr)
    raise SystemExit(2)

__all__ = [
    # Fonts & styles
    "register_fonts", "make_styles",
    # Custom flowables & page template
    "CalloutBox", "BibliographyItem", "BeautifulDoc",
    # PNG renderers
    "_image_from_bytes", "_render_math_png",
    "_render_chart_png", "_render_flowchart_png",
    # Block renderers
    "_divider", "_add_heading", "_add_body", "_add_bullet", "_add_numbered",
    "_add_callout", "_add_table", "_add_image", "_add_figure", "_add_code",
    "_add_math", "_add_chart", "_add_flowchart", "_add_bibliography",
    # Story builder
    "_RESETS_NUMBERED", "build_story",
    # Entry points
    "build", "main",
]


# ══════════════════════════════════════════════════════════════════════════════
# Main build
# ══════════════════════════════════════════════════════════════════════════════

def build(tokens: dict, content: list, out_path: str) -> dict:
    register_fonts(tokens)
    styles = make_styles(tokens)

    doc = BeautifulDoc(
        out_path, tokens,
        pagesize=A4,
        leftMargin=tokens["margin_left"],
        rightMargin=tokens["margin_right"],
        topMargin=tokens["margin_top"],
        bottomMargin=tokens["margin_bottom"],
    )
    doc.build(build_story(content, tokens, styles))

    size = os.path.getsize(out_path)
    return {"status": "ok", "out": out_path, "size_kb": size // 1024}


# ══════════════════════════════════════════════════════════════════════════════
# CLI
# ══════════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(
        description="Render body PDF from tokens.json + content.json"
    )
    parser.add_argument("--tokens",  default="tokens.json")
    parser.add_argument("--content", default="content.json")
    parser.add_argument("--out",     default="body.pdf")
    args = parser.parse_args()

    for fpath in (args.tokens, args.content):
        if not os.path.exists(fpath):
            print(
                json.dumps({"status": "error",
                            "error": f"File not found: {fpath}"}),
                file=sys.stderr,
            )
            sys.exit(1)

    with open(args.tokens,  encoding="utf-8") as f:
        tokens = json.load(f)
    with open(args.content, encoding="utf-8") as f:
        content = json.load(f)

    try:
        result = build(tokens, content, args.out)
        print(json.dumps(result))
    except Exception as e:
        import traceback
        print(
            json.dumps({
                "status": "error",
                "error": str(e),
                "trace": traceback.format_exc(),
            }),
            file=sys.stderr,
        )
        sys.exit(3)


if __name__ == "__main__":
    main()
