"""Cover patterns 9-11: editorial, magazine, darkroom."""

from .base import _base_css


# ── Pattern 9: Editorial — oversized ghost letter + bold type ──────────────────
def _pattern_editorial(t: dict) -> str:
    """
    Magazine / editorial feel:
    - Oversized first-letter of title as a ghost background element (8–12% opacity)
    - Bold category label at top in accent
    - Title in very large condensed weight, flush-left
    - Thin full-width rule separating title from metadata
    - Author / date bottom-left, page type bottom-right
    Designed for editorial reports, annual reviews, magazine-format content.
    """
    bg      = t.get("cover_bg", "#FFFFFF")
    accent  = t["accent"]
    dark    = t.get("dark", "#0A0A0A")
    muted   = t.get("muted", "#777777")
    text_l  = t.get("text_light", "#FFFFFF")

    # Ghost letter — first character of title
    ghost = t['title'][0].upper() if t['title'] else "A"

    subtitle_block = ""
    if t.get("subtitle"):
        subtitle_block = f'<div class="subtitle">{t["subtitle"]}</div>'

    # Determine if background is dark (use light text) or light (use dark text)
    is_dark_bg = (
        bg.startswith("#0") or bg.startswith("#1") or bg.startswith("#2")
    )
    title_color = text_l if is_dark_bg else dark  # noqa: F841
    body_color  = text_l if is_dark_bg else dark

    return f"""<!DOCTYPE html>
<html>
<head><meta charset="UTF-8">
<style>
{_base_css(t)}
html, body {{ background: {bg}; }}
.page {{ background: {bg}; }}

/* Ghost letter — background texture */
.ghost {{
    position: absolute;
    right: -60px; top: -40px;
    font-family: '{t['font_display']}', 'Arial Black', sans-serif;
    font-weight: 900;
    font-size: 680px;
    line-height: 1;
    color: {dark};
    opacity: 0.055;
    user-select: none;
    letter-spacing: -0.05em;
}}

/* Top bar: accent stripe */
.topbar {{
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 5px;
    background: {accent};
}}

/* Category label */
.category {{
    position: absolute;
    top: 40px; left: 60px;
    font-size: 9px; font-weight: 700;
    letter-spacing: 0.30em; text-transform: uppercase;
    color: {accent};
}}

/* Main title block */
.content {{
    position: absolute;
    left: 60px; right: 60px;
    top: 0; bottom: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding-bottom: 80px;
}}

.title {{
    font-family: '{t['font_display']}', 'Arial Black', Impact, sans-serif;
    font-weight: 900;
    font-size: 80px;
    line-height: 0.92;
    color: {body_color};
    letter-spacing: -0.03em;
    max-width: 620px;
    word-wrap: break-word;
    text-transform: uppercase;
}}

.subtitle {{
    font-size: 14px;
    font-weight: 400;
    color: {muted};
    line-height: 1.6;
    max-width: 500px;
    margin-top: 20px;
}}

/* Full-width rule above footer */
.footer-rule {{
    position: absolute;
    bottom: 80px; left: 60px; right: 60px;
    height: 1px;
    background: {body_color};
    opacity: 0.15;
}}

/* Footer row */
.footer {{
    position: absolute;
    bottom: 44px; left: 60px; right: 60px;
    display: flex;
    justify-content: space-between;
    align-items: baseline;
}}
.footer-author {{ font-size: 11px; color: {muted}; letter-spacing: 0.04em; }}
.footer-date   {{ font-size: 10px; color: {muted}; letter-spacing: 0.04em; }}
</style>
</head>
<body>
<div class="page">
    <div class="ghost">{ghost}</div>
    <div class="topbar"></div>
    <div class="category">{t.get('doc_type','').upper()}</div>

    <div class="content">
        <div class="title">{t['title']}</div>
        {subtitle_block}
    </div>

    <div class="footer-rule"></div>
    <div class="footer">
        <div class="footer-author">{t.get('author','')}</div>
        <div class="footer-date">{t.get('date','')}</div>
    </div>
</div>
</body></html>"""


# ── Pattern 10: Magazine — elegant centered with optional hero image ────────────
def _pattern_magazine(t: dict) -> str:
    """
    Upscale centered layout: company name + accent rule at top, large serif title,
    decorative rule, italic subtitle, optional hero image, abstract block, author.
    Used for: annual reports, strategic documents, formal publications.
    """
    bg       = t.get("cover_bg", "#F2F0EC")
    accent   = t["accent"]
    dark     = t.get("dark", "#0D1A2B")
    muted    = t.get("muted", "#888888")
    org      = t.get("doc_type", "").upper()
    img_url  = t.get("cover_image", "")

    subtitle_block = ""
    if t.get("subtitle"):
        subtitle_block = f'<div class="subtitle">{t["subtitle"]}</div>'

    image_block = ""
    if img_url:
        image_block = f"""
        <div style="text-align:center;margin:32px 0 28px;">
            <img src="{img_url}" style="max-width:340px;max-height:220px;
                 object-fit:cover;display:inline-block;"/>
        </div>"""

    abstract_block = ""
    if t.get("abstract"):
        abstract_block = f"""
        <div style="font-size:11px;line-height:1.7;color:{muted};
                    text-align:justify;max-width:560px;margin:0 auto 0;">
            <span style="font-weight:700;color:{accent};">Abstract:</span>
            {t['abstract']}
        </div>"""

    return f"""<!DOCTYPE html>
<html>
<head><meta charset="UTF-8">
<style>
{_base_css(t)}
html, body {{ background: {bg}; }}
.page {{ background: {bg}; display:flex; flex-direction:column;
         align-items:center; justify-content:center; padding:60px 80px; }}

.org-name {{
    font-size: 9px; font-weight: 500; letter-spacing: 0.30em;
    text-transform: uppercase; color: {dark}; text-align:center;
    margin-bottom: 10px;
}}
.org-rule {{
    width: 56px; height: 2px; background: {accent};
    margin: 0 auto 52px;
}}
.title {{
    font-family: '{t['font_display']}', Georgia, 'Times New Roman', serif;
    font-weight: 700; font-size: 52px; line-height: 1.08;
    color: {dark}; text-align: center; letter-spacing: -0.015em;
    max-width: 560px; word-wrap: break-word; margin-bottom: 18px;
}}
.title-rule {{
    width: 44px; height: 2.5px; background: {accent};
    margin: 0 auto 20px;
}}
.subtitle {{
    font-family: '{t['font_display']}', Georgia, serif;
    font-style: italic; font-size: 14px; color: {muted};
    text-align: center; line-height: 1.5; max-width: 440px;
    margin: 0 auto;
}}
.separator {{
    width: 100%; max-width: 620px; height: 1px;
    background: {dark}; opacity: 0.12;
    margin: 28px auto;
}}
.author-name {{
    font-family: '{t['font_display']}', Georgia, serif;
    font-size: 16px; font-weight: 700; color: {accent};
    text-align: center; margin-bottom: 6px;
}}
.date-line {{
    font-size: 11px; color: {muted}; text-align: center;
    letter-spacing: 0.03em;
}}
</style>
</head>
<body>
<div class="page">
    <div class="org-name">{org}</div>
    <div class="org-rule"></div>
    <div class="title">{t['title']}</div>
    <div class="title-rule"></div>
    {subtitle_block}
    {image_block}
    {abstract_block}
    {'<div class="separator"></div>' if (t.get('abstract') or img_url) else '<div style="margin:28px 0;"></div>'}
    <div class="author-name">{t.get('author','')}</div>
    <div class="date-line">{t.get('date','')}</div>
</div>
</body></html>"""


# ── Pattern 11: Darkroom — dark magazine variant ────────────────────────────────
def _pattern_darkroom(t: dict) -> str:
    """
    Dark-background centered layout. Same structure as magazine but inverted:
    deep navy page, white/silver text, accent rules in lighter tone.
    Used for: premium reports, tech annual reviews, dark-themed documents.
    """
    bg       = t.get("cover_bg", "#151C27")
    accent   = t["accent"]
    text_l   = t.get("text_light", "#F0EDE6")
    muted    = t.get("muted", "#8A9AB0")
    org      = t.get("doc_type", "").upper()
    img_url  = t.get("cover_image", "")

    subtitle_block = ""
    if t.get("subtitle"):
        subtitle_block = f'<div class="subtitle">{t["subtitle"]}</div>'

    image_block = ""
    if img_url:
        image_block = f"""
        <div style="text-align:center;margin:32px 0 28px;">
            <img src="{img_url}" style="max-width:340px;max-height:220px;
                 object-fit:cover;display:inline-block;
                 filter:grayscale(20%) brightness(0.9);"/>
        </div>"""

    abstract_block = ""
    if t.get("abstract"):
        abstract_block = f"""
        <div style="font-size:11px;line-height:1.7;color:{muted};
                    text-align:justify;max-width:560px;margin:0 auto 0;">
            <span style="font-weight:700;color:{accent};">Abstract:</span>
            {t['abstract']}
        </div>"""

    return f"""<!DOCTYPE html>
<html>
<head><meta charset="UTF-8">
<style>
{_base_css(t)}
html, body {{ background: {bg}; }}
.page {{ background: {bg}; display:flex; flex-direction:column;
         align-items:center; justify-content:center; padding:60px 80px; }}

.org-name {{
    font-size: 9px; font-weight: 500; letter-spacing: 0.30em;
    text-transform: uppercase; color: {text_l}; text-align:center;
    opacity: 0.75; margin-bottom: 10px;
}}
.org-rule {{
    width: 56px; height: 2px; background: {text_l};
    opacity: 0.35; margin: 0 auto 52px;
}}
.title {{
    font-family: '{t['font_display']}', Georgia, 'Times New Roman', serif;
    font-weight: 700; font-size: 52px; line-height: 1.08;
    color: {text_l}; text-align: center; letter-spacing: -0.015em;
    max-width: 560px; word-wrap: break-word; margin-bottom: 18px;
}}
.title-rule {{
    width: 44px; height: 2.5px; background: {text_l};
    opacity: 0.35; margin: 0 auto 20px;
}}
.subtitle {{
    font-family: '{t['font_display']}', Georgia, serif;
    font-style: italic; font-size: 14px; color: {muted};
    text-align: center; line-height: 1.5; max-width: 440px;
    margin: 0 auto;
}}
.separator {{
    width: 100%; max-width: 620px; height: 1px;
    background: {text_l}; opacity: 0.12;
    margin: 28px auto;
}}
.author-name {{
    font-family: '{t['font_display']}', Georgia, serif;
    font-size: 16px; font-weight: 700; color: {text_l};
    text-align: center; margin-bottom: 6px;
}}
.date-line {{
    font-size: 11px; color: {muted}; text-align: center;
    letter-spacing: 0.03em;
}}
</style>
</head>
<body>
<div class="page">
    <div class="org-name">{org}</div>
    <div class="org-rule"></div>
    <div class="title">{t['title']}</div>
    <div class="title-rule"></div>
    {subtitle_block}
    {image_block}
    {abstract_block}
    {'<div class="separator"></div>' if (t.get('abstract') or img_url) else '<div style="margin:28px 0;"></div>'}
    <div class="author-name">{t.get('author','')}</div>
    <div class="date-line">{t.get('date','')}</div>
</div>
</body></html>"""

