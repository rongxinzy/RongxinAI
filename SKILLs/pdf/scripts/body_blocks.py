#!/usr/bin/env python3
"""
body_blocks.py — Per-block-type renderers + the story builder for body PDFs.

Split out of render_body.py (issue #1069); re-exported there for compatibility.

All block renderer functions share the same signature:
    _add_XXX(story: list, item: dict, ctx: dict)

ctx keys:
    tokens    dict    design tokens from palette.py
    styles    dict    ParagraphStyle objects from body_styles.make_styles()
    usable_w  float   usable page width in points
    acc       str     accent hex color
    acc_lt    str     light accent hex color
    mu        str     muted hex color
    dark      str     dark hex color
    figure_n  int     auto-incrementing figure counter (mutable)
    numbered_n int    auto-incrementing list counter (mutable)
"""

import os

from reportlab.platypus import (
    Paragraph, Spacer, Table, TableStyle,
    HRFlowable, PageBreak, KeepTogether, Preformatted, Image as RLImage,
)
from reportlab.lib.pagesizes import A4
from reportlab.lib.colors import HexColor

from body_flowables import CalloutBox, BibliographyItem
from body_png import (
    _image_from_bytes, _render_math_png, _render_chart_png,
    _render_flowchart_png,
)


# ══════════════════════════════════════════════════════════════════════════════
# Shared helpers
# ══════════════════════════════════════════════════════════════════════════════

def _divider(accent: str) -> HRFlowable:
    return HRFlowable(
        width="100%", thickness=1.2,
        color=HexColor(accent),
        spaceBefore=14, spaceAfter=14,
    )


# ══════════════════════════════════════════════════════════════════════════════
# Block renderers
# ══════════════════════════════════════════════════════════════════════════════

def _add_heading(story: list, item: dict, ctx: dict, level: int):
    key  = f"h{level}"
    para = Paragraph(item["text"], ctx["styles"][key])
    if level == 1:
        story.append(KeepTogether([para, _divider(ctx["acc"])]))
    else:
        story.append(para)


def _add_body(story: list, item: dict, ctx: dict):
    story.append(Paragraph(item["text"], ctx["styles"]["body"]))


def _add_bullet(story: list, item: dict, ctx: dict):
    story.append(Paragraph(
        f"\u2022\u2002{item['text']}", ctx["styles"]["bullet"]
    ))


def _add_numbered(story: list, item: dict, ctx: dict):
    ctx["numbered_n"] += 1
    story.append(Paragraph(
        f"{ctx['numbered_n']}.\u2002{item['text']}",
        ctx["styles"]["numbered"],
    ))


def _add_callout(story: list, item: dict, ctx: dict):
    story.append(Spacer(1, 8))
    story.append(CalloutBox(
        item["text"], ctx["styles"]["callout"], ctx["acc"], ctx["acc_lt"]
    ))
    story.append(Spacer(1, 8))


def _add_table(story: list, item: dict, ctx: dict):
    t        = ctx["tokens"]
    styles   = ctx["styles"]
    usable_w = ctx["usable_w"]
    acc      = ctx["acc"]
    acc_lt   = ctx["acc_lt"]

    headers = [Paragraph(h, styles["table_header"]) for h in item["headers"]]
    rows    = [
        [Paragraph(str(c), styles["table_cell"]) for c in row]
        for row in item.get("rows", [])
    ]
    n_cols = len(item["headers"])

    # Optional col_widths as fractions summing to 1.0
    if "col_widths" in item and len(item["col_widths"]) == n_cols:
        col_w = [usable_w * f for f in item["col_widths"]]
    else:
        col_w = [usable_w / n_cols] * n_cols

    tbl = Table([headers] + rows, colWidths=col_w)
    tbl.setStyle(TableStyle([
        ("BACKGROUND",     (0, 0), (-1,  0), HexColor(acc)),
        ("TEXTCOLOR",      (0, 0), (-1,  0), HexColor("#FFFFFF")),
        ("FONTNAME",       (0, 0), (-1,  0), t["font_body_b_rl"]),
        ("FONTSIZE",       (0, 0), (-1,  0), 9.5),
        ("TOPPADDING",     (0, 0), (-1,  0), 7),
        ("BOTTOMPADDING",  (0, 0), (-1,  0), 7),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1),
         [HexColor("#FFFFFF"), HexColor(acc_lt)]),
        ("FONTNAME",       (0, 1), (-1, -1), t["font_body_rl"]),
        ("FONTSIZE",       (0, 1), (-1, -1), 9.5),
        ("TOPPADDING",     (0, 1), (-1, -1), 6),
        ("BOTTOMPADDING",  (0, 1), (-1, -1), 6),
        ("LEFTPADDING",    (0, 0), (-1, -1), 10),
        ("RIGHTPADDING",   (0, 0), (-1, -1), 10),
        ("BOX",            (0, 0), (-1, -1), 0.5, HexColor("#CCCCCC")),
        ("LINEBELOW",      (0, 0), (-1,  0), 1.2, HexColor(acc)),
        ("TEXTCOLOR",      (0, 1), (-1, -1), HexColor(t["body_text"])),
        ("VALIGN",         (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story.append(tbl)
    if item.get("caption"):
        story.append(Spacer(1, 4))
        story.append(Paragraph(item["caption"], styles["caption"]))
    story.append(Spacer(1, 12))


def _add_image(story: list, item: dict, ctx: dict):
    path = str(item.get("path", item.get("src", "")))
    if not os.path.exists(path):
        story.append(Paragraph(
            f"[Image not found: {path}]", ctx["styles"]["caption"]
        ))
        return
    try:
        img = RLImage(path)
        uw  = ctx["usable_w"]
        if img.drawWidth > uw:
            scale = uw / img.drawWidth
            img.drawWidth  = uw
            img.drawHeight = img.drawHeight * scale
        story.append(img)
    except Exception as e:
        story.append(Paragraph(f"[Image error: {e}]", ctx["styles"]["caption"]))
        return
    if item.get("caption"):
        story.append(Spacer(1, 4))
        story.append(Paragraph(item["caption"], ctx["styles"]["caption"]))
    story.append(Spacer(1, 8))


def _add_figure(story: list, item: dict, ctx: dict):
    """Like image but auto-numbers the caption as 'Figure N: ...'."""
    ctx["figure_n"] += 1
    raw_cap = item.get("caption", "")
    caption = f"Figure {ctx['figure_n']}: {raw_cap}" if raw_cap \
              else f"Figure {ctx['figure_n']}"
    _add_image(story, {**item, "caption": caption}, ctx)


def _add_code(story: list, item: dict, ctx: dict):
    acc    = ctx["acc"]
    acc_lt = ctx["acc_lt"]
    mu     = ctx["mu"]
    uw     = ctx["usable_w"]
    lang   = item.get("language", "")

    pre = Preformatted(item.get("text", ""), ctx["styles"]["code"])
    tbl = Table([[pre]], colWidths=[uw])
    tbl.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), HexColor(acc_lt)),
        ("LINEBEFORE",    (0, 0), ( 0, -1), 3,   HexColor(acc)),
        ("BOX",           (0, 0), (-1, -1), 0.5, HexColor(mu)),
        ("LEFTPADDING",   (0, 0), (-1, -1), 14),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 10),
        ("TOPPADDING",    (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(Spacer(1, 6))
    if lang:
        story.append(Paragraph(lang.upper(), ctx["styles"]["code_lang"]))
    story.append(tbl)
    story.append(Spacer(1, 6))


def _add_math(story: list, item: dict, ctx: dict):
    """
    Display math block.

    Fields:
        text     LaTeX math expression (without enclosing $)
        label    optional equation label, e.g. "(1)" — displayed right-aligned
        caption  optional caption below the formula

    Example:
        {"type": "math", "text": "E = mc^2", "label": "(1)"}
        {"type": "math", "text": "\\\\int_0^\\\\infty e^{-x^2}\\\\,dx = \\\\frac{\\\\sqrt{\\\\pi}}{2}"}
    """
    acc    = ctx["acc"]
    acc_lt = ctx["acc_lt"]
    uw     = ctx["usable_w"]
    expr   = item.get("text", "").strip()
    label  = item.get("label", "").strip()

    png = _render_math_png(expr)

    if png is None:
        # Graceful text fallback if matplotlib unavailable
        story.append(Spacer(1, 6))
        pre = Preformatted(f"  {expr}", ctx["styles"]["math_fallback"])
        tbl = Table([[pre]], colWidths=[uw])
        tbl.setStyle(TableStyle([
            ("BACKGROUND",    (0, 0), (-1, -1), HexColor(acc_lt)),
            ("LEFTPADDING",   (0, 0), (-1, -1), 14),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 14),
            ("TOPPADDING",    (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ]))
        story.append(tbl)
        story.append(Spacer(1, 6))
        return

    img = _image_from_bytes(png, uw, max_frac=0.72)
    story.append(Spacer(1, 10))

    if label:
        label_w   = 44
        formula_w = uw - label_w
        lbl_para  = Paragraph(label, ctx["styles"]["eq_label"])
        row_tbl   = Table([[img, lbl_para]], colWidths=[formula_w, label_w])
        row_tbl.setStyle(TableStyle([
            ("ALIGN",  (0, 0), (0, 0), "CENTER"),
            ("ALIGN",  (1, 0), (1, 0), "RIGHT"),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ]))
        story.append(row_tbl)
    else:
        row_tbl = Table([[img]], colWidths=[uw])
        row_tbl.setStyle(TableStyle([
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ]))
        story.append(row_tbl)

    if item.get("caption"):
        story.append(Spacer(1, 4))
        story.append(Paragraph(item["caption"], ctx["styles"]["caption"]))
    story.append(Spacer(1, 10))


def _add_chart(story: list, item: dict, ctx: dict):
    """
    Render a chart (bar / line / pie) via matplotlib.

    Fields:
        chart_type  "bar" | "line" | "pie"  (default "bar")
        title       chart title
        labels      list of category strings
        datasets    list of {label?, values: list[number]}
        x_label     X-axis label (bar/line)
        y_label     Y-axis label (bar/line)
        caption     caption text below chart
        figure      bool (default true) — prefix caption with "Figure N:"
    """
    uw  = ctx["usable_w"]
    png = _render_chart_png(item, ctx["acc"])

    if png is None:
        story.append(Paragraph(
            "[Chart: install matplotlib to render — pip install matplotlib]",
            ctx["styles"]["caption"],
        ))
        return

    img = _image_from_bytes(png, uw, max_frac=0.95)
    story.append(Spacer(1, 8))
    row_tbl = Table([[img]], colWidths=[uw])
    row_tbl.setStyle(TableStyle([("ALIGN", (0, 0), (-1, -1), "CENTER")]))
    story.append(row_tbl)

    raw_cap = item.get("caption", "")
    use_fig = item.get("figure", True)
    if raw_cap or use_fig:
        ctx["figure_n"] += 1
        prefix  = f"Figure {ctx['figure_n']}: " if use_fig else ""
        story.append(Spacer(1, 4))
        story.append(Paragraph(prefix + raw_cap, ctx["styles"]["caption"]))
    story.append(Spacer(1, 10))


def _add_flowchart(story: list, item: dict, ctx: dict):
    """
    Render a flowchart via matplotlib.

    Fields:
        nodes   list of {id, label, shape?}
                  shape: "rect" (default) | "diamond" | "oval" | "parallelogram"
        edges   list of {from, to, label?}
        caption caption below the diagram
        figure  bool (default true) — prefix caption with "Figure N:"
    """
    uw  = ctx["usable_w"]
    png = _render_flowchart_png(item, ctx["acc"], ctx["dark"], ctx["mu"])

    if png is None:
        story.append(Paragraph(
            "[Flowchart: install matplotlib to render — pip install matplotlib]",
            ctx["styles"]["caption"],
        ))
        return

    img = _image_from_bytes(png, uw, max_frac=0.78)
    story.append(Spacer(1, 8))
    row_tbl = Table([[img]], colWidths=[uw])
    row_tbl.setStyle(TableStyle([("ALIGN", (0, 0), (-1, -1), "CENTER")]))
    story.append(row_tbl)

    raw_cap = item.get("caption", "")
    use_fig = item.get("figure", True)
    if raw_cap or use_fig:
        ctx["figure_n"] += 1
        prefix  = f"Figure {ctx['figure_n']}: " if use_fig else ""
        story.append(Spacer(1, 4))
        story.append(Paragraph(prefix + raw_cap, ctx["styles"]["caption"]))
    story.append(Spacer(1, 10))


def _add_bibliography(story: list, item: dict, ctx: dict):
    """
    Numbered reference list with hanging indent.

    Fields:
        title   section heading (default "References"); set "" to suppress
        items   list of {id, text}

    Example:
        {"type": "bibliography",
         "items": [
           {"id": "1", "text": "Smith, J. (2023). Title. Journal, 10(2), 1–15."},
           {"id": "2", "text": "Doe, A. (2022). Another title. Publisher."}
         ]}
    """
    heading = item.get("title", "References")
    if heading:
        story.append(KeepTogether([
            Paragraph(heading, ctx["styles"]["bib_title"]),
            _divider(ctx["acc"]),
        ]))

    for ref in item.get("items", []):
        story.append(Spacer(1, 4))
        story.append(BibliographyItem(
            str(ref.get("id", "")),
            ref.get("text", ""),
            ctx["styles"]["bib"],
            ctx["dark"],
        ))


# ══════════════════════════════════════════════════════════════════════════════
# Story builder
# ══════════════════════════════════════════════════════════════════════════════

# Block types that break a numbered list sequence
_RESETS_NUMBERED = frozenset({
    "h1", "h2", "h3", "body", "bullet", "callout", "table",
    "image", "figure", "code", "math", "chart", "flowchart",
    "bibliography", "divider", "caption", "pagebreak", "spacer",
})


def build_story(content: list, tokens: dict, styles: dict) -> list:
    usable_w = A4[0] - tokens["margin_left"] - tokens["margin_right"]

    ctx: dict = {
        "tokens":     tokens,
        "styles":     styles,
        "usable_w":   usable_w,
        "acc":        tokens["accent"],
        "acc_lt":     tokens["accent_lt"],
        "mu":         tokens["muted"],
        "dark":       tokens["dark"],
        "figure_n":   0,
        "numbered_n": 0,
    }

    story: list = []

    for item in content:
        kind = item.get("type", "body")

        if kind in _RESETS_NUMBERED:
            ctx["numbered_n"] = 0

        if   kind == "h1":           _add_heading(story, item, ctx, 1)
        elif kind == "h2":           _add_heading(story, item, ctx, 2)
        elif kind == "h3":           _add_heading(story, item, ctx, 3)
        elif kind == "body":         _add_body(story, item, ctx)
        elif kind == "bullet":       _add_bullet(story, item, ctx)
        elif kind == "numbered":     _add_numbered(story, item, ctx)
        elif kind == "callout":      _add_callout(story, item, ctx)
        elif kind == "table":        _add_table(story, item, ctx)
        elif kind == "image":        _add_image(story, item, ctx)
        elif kind == "figure":       _add_figure(story, item, ctx)
        elif kind == "code":         _add_code(story, item, ctx)
        elif kind == "math":         _add_math(story, item, ctx)
        elif kind == "chart":        _add_chart(story, item, ctx)
        elif kind == "flowchart":    _add_flowchart(story, item, ctx)
        elif kind == "bibliography": _add_bibliography(story, item, ctx)
        elif kind == "divider":      story.append(_divider(ctx["acc"]))
        elif kind == "caption":
            story.append(Paragraph(item["text"], styles["caption"]))
        elif kind == "pagebreak":    story.append(PageBreak())
        elif kind == "spacer":       story.append(Spacer(1, item.get("pt", 12)))

    return story
