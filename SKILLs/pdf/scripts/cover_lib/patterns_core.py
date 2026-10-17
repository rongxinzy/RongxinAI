"""Cover patterns 1-4: fullbleed, split, typographic, atmospheric."""

from .base import _base_css, _dot_grid


# ── Pattern 1: Full-bleed block ────────────────────────────────────────────────
def _pattern_fullbleed(t: dict) -> str:
    dot_grid = _dot_grid(
        x0=500, y0=40, cols=10, rows=20, gap=24, r=1.8,
        color=t["accent"], opacity=0.12
    )
    subtitle_block = ""
    if t.get("subtitle"):
        subtitle_block = f"""
        <div style="font-size:14px;color:{t['muted']};letter-spacing:0.01em;
                    max-width:480px;line-height:1.5;margin-bottom:40px;">
            {t['subtitle']}
        </div>"""

    return f"""<!DOCTYPE html>
<html>
<head><meta charset="UTF-8">
<style>
{_base_css(t)}
.label {{
    font-size: 9px; font-weight: 500; letter-spacing: 0.22em;
    color: {t['accent']}; text-transform: uppercase; margin-bottom: 28px;
}}
.title {{
    font-family: '{t['font_display']}', 'Times New Roman', Georgia, serif;
    font-weight: 900; font-size: 60px; line-height: 1.0;
    color: {t['text_light']}; letter-spacing: -0.015em;
    margin-bottom: 10px; max-width: 560px;
    word-wrap: break-word;
}}
.rule {{
    width: 52%; height: 1.5px;
    background: linear-gradient(to right, {t['accent']}, transparent);
    margin: 24px 0 20px;
}}
.content {{
    position: absolute; left: 68px; right: 60px;
    top: 0; bottom: 0;
    display: flex; flex-direction: column; justify-content: center;
    padding-top: 60px;
}}
.footer {{
    position: absolute; bottom: 0; left: 0; right: 0;
    height: 70px;
    background: rgba(0,0,0,0.22);
    display: flex; align-items: center;
    justify-content: space-between;
    padding: 0 68px;
}}
.footer-author {{ font-size: 11px; color: rgba(240,237,230,0.75); letter-spacing:0.04em; }}
.footer-date   {{ font-size: 11px; color: {t['muted']}; letter-spacing: 0.04em; }}
</style>
</head>
<body>
<div class="page">
    <!-- top-right accent strip -->
    <div style="position:absolute;top:0;right:0;width:35%;height:4px;background:{t['accent']};"></div>
    <!-- left vertical accent bar (gradient fade) -->
    <div style="position:absolute;left:48px;top:18%;width:3px;height:60%;
                background:linear-gradient(to bottom,{t['accent']},transparent);"></div>
    <!-- dot grid background texture -->
    {dot_grid}

    <div class="content">
        <div class="label">{t.get('doc_type','Document').upper()} &nbsp;·&nbsp; {t.get('date','')}</div>
        <div class="title">{t['title']}</div>
        <div class="rule"></div>
        {subtitle_block}
    </div>

    <div class="footer">
        <div class="footer-author">{t.get('author','')}</div>
        <div class="footer-date">{t.get('date','')}</div>
    </div>
</div>
</body></html>"""


# ── Pattern 2: Split panel ─────────────────────────────────────────────────────
def _pattern_split(t: dict) -> str:
    dot_grid = _dot_grid(
        x0=360, y0=120, cols=10, rows=18, gap=22, r=2,
        color="#CCCCCC", opacity=0.25
    )
    return f"""<!DOCTYPE html>
<html>
<head><meta charset="UTF-8">
<style>
{_base_css(t)}
.left-panel {{
    position: absolute; top: 0; left: 0;
    width: 330px; height: 1123px;
    background: {t['cover_bg']};
    display: flex; flex-direction: column;
    justify-content: center;
    padding: 0 44px;
}}
.right-panel {{
    position: absolute; top: 0; left: 330px;
    width: 464px; height: 1123px;
    background: {t['page_bg']};
}}
.divider {{
    position: absolute; top: 0; left: 329px;
    width: 3px; height: 1123px;
    background: {t['accent']};
}}
.left-top-bar {{
    position: absolute; top: 0; left: 0;
    width: 330px; height: 4px;
    background: {t['accent']};
}}
.title {{
    font-family: '{t['font_display']}', 'Times New Roman', serif;
    font-weight: 900; font-size: 34px; line-height: 1.2;
    color: {t['text_light']}; margin-bottom: 18px;
    word-wrap: break-word;
}}
.rule {{
    width: 55%; height: 1.5px;
    background: {t['accent']};
    margin-bottom: 14px;
}}
.subtitle {{
    font-size: 12px; color: rgba(220,220,220,0.65);
    line-height: 1.5; margin-bottom: 32px;
}}
.author {{
    font-size: 11px; color: {t['text_light']}; margin-bottom: 4px;
}}
.date {{ font-size: 10px; color: {t['muted']}; }}
.right-label {{
    position: absolute; bottom: 60px; right: 44px;
    font-size: 9px; letter-spacing: 0.18em;
    color: {t['muted']}; text-transform: uppercase;
}}
</style>
</head>
<body>
<div class="page">
    <div class="left-top-bar"></div>
    <div class="left-panel">
        <div class="title">{t['title']}</div>
        <div class="rule"></div>
        {'<div class="subtitle">' + t['subtitle'] + '</div>' if t.get('subtitle') else ''}
        <div class="author">{t.get('author','')}</div>
        <div class="date">{t.get('date','')}</div>
    </div>
    <div class="right-panel">
        {dot_grid}
    </div>
    <div class="divider"></div>
    <div class="right-label">{t.get('doc_type','').upper()}</div>
</div>
</body></html>"""


# ── Pattern 3: Typographic ─────────────────────────────────────────────────────
def _pattern_typographic(t: dict) -> str:
    words = t['title'].split()
    first = words[0] if words else ""
    rest  = " ".join(words[1:]) if len(words) > 1 else ""
    return f"""<!DOCTYPE html>
<html>
<head><meta charset="UTF-8">
<style>
{_base_css(t)}
html, body {{ background: {t['page_bg']}; }}
.page {{ background: {t['page_bg']}; }}
.content {{
    position: absolute; left: 60px; top: 0; bottom: 0; right: 60px;
    display: flex; flex-direction: column; justify-content: center;
}}
.first-word {{
    font-family: '{t['font_display']}', 'Times New Roman', serif;
    font-weight: 900; font-size: 72px; line-height: 1.0;
    color: {t['accent']}; letter-spacing: -0.02em;
}}
.rest-words {{
    font-family: '{t['font_display']}', 'Times New Roman', serif;
    font-weight: 900; font-size: 72px; line-height: 1.0;
    color: {t['dark']}; letter-spacing: -0.02em;
    margin-bottom: 12px;
}}
.rule {{
    width: 100%; height: 1.5px;
    background: linear-gradient(to right, {t['accent']}, {t['accent']}40);
    margin: 28px 0 20px;
}}
.meta-row {{
    display: flex; justify-content: space-between; align-items: baseline;
}}
.author  {{ font-size: 13px; color: {t['dark']}; letter-spacing: 0.02em; }}
.date    {{ font-size: 12px; color: {t['muted']}; }}
.subtitle {{ font-size: 13px; color: {t['muted']}; margin-top: 8px; max-width: 500px; }}
</style>
</head>
<body>
<div class="page">
    <div class="content">
        <div class="first-word">{first}</div>
        {'<div class="rest-words">' + rest + '</div>' if rest else ''}
        <div class="rule"></div>
        <div class="meta-row">
            <div class="author">{t.get('author','')}</div>
            <div class="date">{t.get('date','')}</div>
        </div>
        {'<div class="subtitle">' + t['subtitle'] + '</div>' if t.get('subtitle') else ''}
    </div>
</div>
</body></html>"""


# ── Pattern 4: Dark atmospheric ────────────────────────────────────────────────
def _pattern_atmospheric(t: dict) -> str:
    dot_grid = _dot_grid(
        x0=60, y0=60, cols=16, rows=22, gap=20, r=1.5,
        color=t["accent"], opacity=0.08
    )
    return f"""<!DOCTYPE html>
<html>
<head><meta charset="UTF-8">
<style>
{_base_css(t)}
.glow {{
    position: absolute;
    top: -100px; right: -80px;
    width: 500px; height: 500px;
    background: radial-gradient(circle, {t['accent']}2E 0%, transparent 68%);
    border-radius: 50%;
}}
.glow2 {{
    position: absolute;
    bottom: -40px; left: 10%;
    width: 300px; height: 300px;
    background: radial-gradient(circle, {t['accent']}14 0%, transparent 70%);
    border-radius: 50%;
}}
.content {{
    position: absolute; left: 64px; right: 80px;
    top: 0; bottom: 0;
    display: flex; flex-direction: column; justify-content: center;
}}
.label {{
    font-size: 9px; letter-spacing: 0.22em;
    color: {t['accent']}; text-transform: uppercase; margin-bottom: 32px;
}}
.title {{
    font-family: '{t['font_display']}', 'Times New Roman', serif;
    font-weight: 900; font-size: 50px; line-height: 1.05;
    color: {t['text_light']}; max-width: 520px;
    word-wrap: break-word; margin-bottom: 12px;
}}
.rule {{ width: 48px; height: 2px; background: {t['accent']}; margin: 24px 0 20px; }}
.subtitle {{
    font-size: 13px; color: {t['muted']}; line-height: 1.6;
    max-width: 400px; margin-bottom: 40px;
}}
.footer {{
    position: absolute; bottom: 0; left: 0; right: 0; height: 64px;
    border-top: 1px solid rgba(255,255,255,0.06);
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 64px;
}}
.footer-l {{ font-size: 10.5px; color: rgba(240,237,230,0.6); }}
.footer-r {{ font-size: 10.5px; color: {t['muted']}; }}
</style>
</head>
<body>
<div class="page">
    <div class="glow"></div>
    <div class="glow2"></div>
    {dot_grid}
    <div style="position:absolute;top:0;right:0;width:30%;height:3px;background:{t['accent']};"></div>
    <div class="content">
        <div class="label">{t.get('doc_type','').upper()} &nbsp;·&nbsp; {t.get('date','')}</div>
        <div class="title">{t['title']}</div>
        <div class="rule"></div>
        {'<div class="subtitle">' + t['subtitle'] + '</div>' if t.get('subtitle') else ''}
    </div>
    <div class="footer">
        <div class="footer-l">{t.get('author','')}</div>
        <div class="footer-r">{t.get('date','')}</div>
    </div>
</div>
</body></html>"""

