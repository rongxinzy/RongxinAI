"""Cover patterns 12-13: terminal, poster."""

from .base import _base_css


# ── Pattern 12: Terminal — cyber/hacker aesthetic ───────────────────────────────
def _pattern_terminal(t: dict) -> str:
    """
    Dark terminal/IDE aesthetic: grid overlay, monospace font, neon accent,
    corner brackets around the title block, status bar at bottom.
    Used for: tech reports, developer docs, security audits, system documentation.
    """
    bg      = t.get("cover_bg", "#0D1117")
    accent  = t["accent"]
    text_l  = t.get("text_light", "#E6EDF3")
    muted   = t.get("muted", "#48897C")
    dark    = t.get("dark", "#010409")
    org     = t.get("doc_type", "DOCUMENT").upper()
    date_s  = t.get("date", "")
    author  = t.get("author", "")

    subtitle_line = ""
    if t.get("subtitle"):
        subtitle_line = f'<div class="subtitle">&gt; {t["subtitle"]}</div>'

    abstract_block = ""
    if t.get("abstract"):
        abstract_block = f"""
        <div class="abstract-text">{t['abstract']}</div>"""

    # grid overlay: horizontal + vertical lines
    h_lines = "".join(
        f'<line x1="0" y1="{y}" x2="794" y2="{y}" stroke="{accent}" stroke-width="0.4"/>'
        for y in range(0, 1124, 48)
    )
    v_lines = "".join(
        f'<line x1="{x}" y1="0" x2="{x}" y2="1123" stroke="{accent}" stroke-width="0.4"/>'
        for x in range(0, 795, 48)
    )
    grid_svg = (
        f'<svg style="position:absolute;top:0;left:0;width:794px;height:1123px;'
        f'pointer-events:none;opacity:0.07" xmlns="http://www.w3.org/2000/svg">'
        + h_lines + v_lines + "</svg>"
    )

    return f"""<!DOCTYPE html>
<html>
<head><meta charset="UTF-8">
<style>
{_base_css(t)}
html, body {{ background: {bg}; }}
.page {{ background: {bg}; }}

/* Terminal label — top */
.term-label {{
    position: absolute; top: 44px; left: 56px; right: 56px;
    display: flex; align-items: center; gap: 10px;
}}
.dot {{
    width: 8px; height: 8px; border-radius: 50%;
    background: {accent}; flex-shrink: 0;
}}
.term-meta {{
    font-family: '{t['font_body']}', 'Courier New', monospace;
    font-size: 10px; color: {accent}; letter-spacing: 0.08em;
    text-transform: uppercase;
}}

/* Title bracket block */
.bracket-block {{
    position: absolute;
    top: 310px; left: 56px; right: 56px;
    border-left: 2px solid {accent}; border-top: 2px solid {accent};
    padding: 24px 28px 28px;
    box-shadow: inset 0 0 0 0;
}}
.bracket-block::after {{
    content: '';
    position: absolute;
    bottom: 0; right: 0;
    width: 32px; height: 2px;
    background: {accent};
}}
.bracket-block::before {{
    content: '';
    position: absolute;
    bottom: 0; right: 0;
    width: 2px; height: 32px;
    background: {accent};
}}

.title {{
    font-family: '{t['font_display']}', 'Courier New', monospace;
    font-weight: 700; font-size: 46px; line-height: 1.05;
    color: {text_l}; letter-spacing: 0.01em;
    text-transform: uppercase;
    word-wrap: break-word; margin-bottom: 16px;
}}
.subtitle {{
    font-family: '{t['font_body']}', 'Courier New', monospace;
    font-size: 13px; color: {accent};
    line-height: 1.5; letter-spacing: 0.02em;
    margin-top: 8px;
}}

/* Content block below brackets */
.content-lower {{
    position: absolute;
    top: 640px; left: 56px; right: 56px;
    display: flex; gap: 40px; align-items: flex-start;
}}
.abstract-text {{
    font-family: '{t['font_body']}', 'Courier New', monospace;
    font-size: 10.5px; line-height: 1.8; color: {muted};
    flex: 1;
}}
.author-block {{
    text-align: right; flex-shrink: 0; min-width: 160px;
}}
.author-label {{
    font-family: '{t['font_body']}', monospace;
    font-size: 8px; letter-spacing: 0.20em; color: {muted};
    text-transform: uppercase; margin-bottom: 6px;
}}
.author-name {{
    font-family: '{t['font_body']}', monospace;
    font-size: 14px; font-weight: 700; color: {text_l};
}}
.author-org {{
    font-family: '{t['font_body']}', monospace;
    font-size: 10px; color: {accent}; margin-top: 4px;
}}

/* Bottom status bar */
.statusbar {{
    position: absolute; bottom: 0; left: 0; right: 0;
    height: 36px; background: {accent}; opacity: 0.12;
}}
.statusbar-text {{
    position: absolute; bottom: 0; left: 0; right: 0;
    height: 36px; display: flex; align-items: center;
    justify-content: space-between; padding: 0 56px;
}}
.sb-item {{
    font-family: '{t['font_body']}', monospace;
    font-size: 9px; color: {muted}; letter-spacing: 0.12em;
    text-transform: uppercase;
}}
</style>
</head>
<body>
<div class="page">
    {grid_svg}

    <div class="term-label">
        <div class="dot"></div>
        <div class="term-meta">SYSTEM_REPORT // {date_s}</div>
    </div>

    <div class="bracket-block">
        <div class="title">{t['title']}</div>
        {subtitle_line}
    </div>

    <div class="content-lower">
        {abstract_block}
        <div class="author-block">
            <div class="author-label">AUTHOR_ID</div>
            <div class="author-name">{author}</div>
            <div class="author-org">{org}</div>
        </div>
    </div>

    <div class="statusbar"></div>
    <div class="statusbar-text">
        <div class="sb-item">Ln 1, Col 1</div>
        <div class="sb-item">UTF-8</div>
        <div class="sb-item">GENERATED_BY_COVERGENIUS</div>
    </div>
</div>
</body></html>"""


# ── Pattern 13: Poster — bold sidebar + oversized type ─────────────────────────
def _pattern_poster(t: dict) -> str:
    """
    Bold minimalist poster: thick vertical sidebar on the left, oversized all-caps
    title, typewriter-style metadata. Optional thumbnail on the right side.
    Used for: portfolios, creative reports, journalism, photography books.
    """
    bg      = t.get("cover_bg", "#FFFFFF")
    accent  = t["accent"]       # typically black or strong dark
    dark    = t.get("dark", "#0A0A0A")
    muted   = t.get("muted", "#888888")
    text_l  = t.get("text_light", "#FFFFFF")
    img_url = t.get("cover_image", "")

    sidebar_w = 52

    subtitle_block = ""
    if t.get("subtitle"):
        subtitle_block = f'<div class="subtitle">{t["subtitle"]}</div>'

    image_block = ""
    if img_url:
        image_block = f"""
        <img src="{img_url}" style="
            width:260px;height:340px;object-fit:cover;
            display:block;margin-top:32px;
            filter:grayscale(100%) contrast(1.1);"/>"""

    meta_lines = []
    if t.get("author"):
        meta_lines.append(f'<div class="meta-line">{t["author"]}</div>')
    if t.get("subtitle"):
        meta_lines.append(f'<div class="meta-line meta-role">{t["subtitle"]}</div>')
    if t.get("date"):
        meta_lines.append(f'<div class="meta-line meta-date">{t["date"]}</div>')
    meta_block = "\n".join(meta_lines)

    return f"""<!DOCTYPE html>
<html>
<head><meta charset="UTF-8">
<style>
{_base_css(t)}
html, body {{ background: {bg}; }}
.page {{ background: {bg}; }}

/* Left sidebar — the dominant color element */
.sidebar {{
    position: absolute;
    top: 0; left: 0;
    width: {sidebar_w}px; height: 1123px;
    background: {accent};
}}

/* Main content — offset from sidebar */
.content {{
    position: absolute;
    left: {sidebar_w + 52}px; right: 52px;
    top: 100px; bottom: 80px;
}}

/* Oversized display title */
.title {{
    font-family: '{t['font_display']}', 'Arial Black', Impact, sans-serif;
    font-weight: 900;
    font-size: 96px;
    line-height: 0.92;
    color: {dark};
    letter-spacing: -0.03em;
    text-transform: uppercase;
    max-width: 620px;
    word-wrap: break-word;
    margin-bottom: 22px;
}}

.subtitle {{
    font-family: '{t['font_body']}', 'Courier New', monospace;
    font-size: 12px;
    color: {muted};
    letter-spacing: 0.05em;
    margin-bottom: 0;
}}

/* Thin rule under title area */
.rule {{
    width: 64px; height: 2px;
    background: {dark};
    margin: 24px 0 28px;
}}

/* Author / meta in typewriter font */
.meta-group {{
    margin-top: 32px;
}}
.meta-line {{
    font-family: '{t['font_body']}', 'Courier New', monospace;
    font-size: 12px; color: {dark};
    line-height: 1.8; letter-spacing: 0.02em;
}}
.meta-role {{
    font-family: '{t['font_body']}', 'Courier New', monospace;
    color: {muted};
}}
.meta-date {{
    font-family: '{t['font_body']}', 'Courier New', monospace;
    font-size: 12px; color: {dark};
    margin-top: 8px;
}}

/* Right-side content area for thumbnail */
.right-col {{
    position: absolute;
    right: 52px;
    top: 380px; bottom: 80px;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
}}

/* Small accent square icon */
.icon-block {{
    width: 64px; height: 64px;
    background: {accent};
    margin-top: 28px;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
}}
.icon-lines {{
    display: flex; flex-direction: column; gap: 6px;
}}
.icon-line {{
    height: 2px; background: {text_l};
}}
</style>
</head>
<body>
<div class="page">
    <div class="sidebar"></div>

    <div class="content">
        <div class="title">{t['title']}</div>
        {subtitle_block}
        <div class="rule"></div>
        <div class="meta-group">{meta_block}</div>
    </div>

    <div class="right-col">
        {image_block}
        <div class="icon-block">
            <div class="icon-lines">
                <div class="icon-line" style="width:32px;"></div>
                <div class="icon-line" style="width:24px;"></div>
                <div class="icon-line" style="width:28px;"></div>
            </div>
        </div>
    </div>
</div>
</body></html>"""

