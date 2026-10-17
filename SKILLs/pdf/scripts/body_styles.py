#!/usr/bin/env python3
"""
body_styles.py — Font registration + ParagraphStyle factory for body PDFs.

Split out of render_body.py (issue #1069); re-exported there for compatibility.
"""

import os

from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_JUSTIFY, TA_CENTER
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont


def register_fonts(tokens: dict):
    """Register TTF fonts from token font_paths if present."""
    for name, fpath in tokens.get("font_paths", {}).items():
        if os.path.exists(fpath):
            try:
                pdfmetrics.registerFont(TTFont(name, fpath))
            except Exception:
                pass


def make_styles(t: dict) -> dict:
    hf  = t["font_display_rl"]
    bf  = t["font_body_rl"]
    bfb = t["font_body_b_rl"]
    dk  = t["body_text"]
    d   = t["dark"]
    mu  = t["muted"]

    return {
        "h1": ParagraphStyle("H1",
            fontName=hf, fontSize=t["size_h1"],
            leading=t["size_h1"] * 1.3,
            textColor=HexColor(d),
            spaceBefore=t["section_gap"], spaceAfter=4,
        ),
        "h2": ParagraphStyle("H2",
            fontName=hf, fontSize=t["size_h2"],
            leading=t["size_h2"] * 1.4,
            textColor=HexColor(d),
            spaceBefore=18, spaceAfter=5,
        ),
        "h3": ParagraphStyle("H3",
            fontName=bfb, fontSize=t["size_h3"],
            leading=t["size_h3"] * 1.5,
            textColor=HexColor(d),
            spaceBefore=12, spaceAfter=3,
        ),
        "body": ParagraphStyle("Body",
            fontName=bf, fontSize=t["size_body"],
            leading=t["line_gap"],
            textColor=HexColor(dk),
            spaceAfter=t["para_gap"], alignment=TA_JUSTIFY,
        ),
        "bullet": ParagraphStyle("Bullet",
            fontName=bf, fontSize=t["size_body"],
            leading=t["line_gap"] - 1,
            textColor=HexColor(dk),
            spaceAfter=4, leftIndent=14,
        ),
        "numbered": ParagraphStyle("Numbered",
            fontName=bf, fontSize=t["size_body"],
            leading=t["line_gap"] - 1,
            textColor=HexColor(dk),
            spaceAfter=4, leftIndent=22, firstLineIndent=-22,
        ),
        "callout": ParagraphStyle("Callout",
            fontName=bfb, fontSize=t["size_body"] + 0.5, leading=16,
            textColor=HexColor(d),
        ),
        "caption": ParagraphStyle("Caption",
            fontName=bf, fontSize=t["size_caption"], leading=13,
            textColor=HexColor(mu), spaceAfter=6,
            alignment=TA_CENTER,
        ),
        "table_header": ParagraphStyle("TblH",
            fontName=bfb, fontSize=9.5, leading=13,
            textColor=HexColor("#FFFFFF"),
        ),
        "table_cell": ParagraphStyle("TblC",
            fontName=bf, fontSize=9.5, leading=13,
            textColor=HexColor(dk),
        ),
        "code": ParagraphStyle("Code",
            fontName="Courier", fontSize=8.5, leading=12.5,
            textColor=HexColor(dk),
        ),
        "code_lang": ParagraphStyle("CodeLang",
            fontName="Courier", fontSize=7, leading=10,
            textColor=HexColor(mu),
        ),
        "bib": ParagraphStyle("Bib",
            fontName=bf, fontSize=9, leading=14,
            textColor=HexColor(dk),
        ),
        "bib_title": ParagraphStyle("BibTitle",
            fontName=hf, fontSize=t["size_h2"],
            leading=t["size_h2"] * 1.4,
            textColor=HexColor(d),
            spaceBefore=t["section_gap"], spaceAfter=8,
        ),
        "math_fallback": ParagraphStyle("MathFb",
            fontName="Courier", fontSize=9, leading=13,
            textColor=HexColor(dk),
        ),
        "eq_label": ParagraphStyle("EqLabel",
            fontName="Helvetica", fontSize=9, leading=12,
            textColor=HexColor(mu),
        ),
    }
