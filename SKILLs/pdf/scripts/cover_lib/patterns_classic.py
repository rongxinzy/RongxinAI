"""Cover patterns 5-8: minimal, stripe, diagonal, frame."""

from .base import _base_css


# ── Pattern 5: Minimal — thick left bar, generous whitespace ───────────────────
def _pattern_minimal(t: dict) -> str:
    """
    Ultra-restrained: white background, 8px left accent bar, oversized light-weight
    title, nothing else but a hairline rule and minimal metadata. The bar is the only
    color on the page — everything else is black on white.
    """
    # Pick text color for page (minimal uses page_bg which is near-white)
    text_dark = t.get("dark", "#111111")
    muted     = t.get("muted", "#999999")
    accent    = t["accent"]

    subtitle_block = ""
    if t.get("subtitle"):
        subtitle_block = f'<div class="subtitle">{t["subtitle"]}</div>'

    return f"""<!DOCTYPE html>
<html>
<head><meta charset="UTF-8">
<style>
{_base_css(t)}
html, body {{ background: {t['page_bg']}; }}
.page {{ background: {t['page_bg']}; }}

/* Left accent bar — the only color element */
.bar {{
    position: absolute;
    top: 0; left: 0;
    width: 8px; height: 1123px;
    background: {accent};
}}

/* Main content column — offset from bar */
.content {{
    position: absolute;
    left: 64px; right: 64px;
    top: 0; bottom: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding-bottom: 40px;
}}

.eyebrow {{
    font-size: 9px;
    font-weight: 500;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: {accent};
    margin-bottom: 36px;
}}

.title {{
    font-family: '{t['font_display']}', Georgia, 'Times New Roman', serif;
    font-weight: 300;
    font-size: 72px;
    line-height: 1.0;
    color: {text_dark};
    letter-spacing: -0.02em;
    max-width: 580px;
    word-wrap: break-word;
    margin-bottom: 0;
}}

.rule {{
    width: 56px;
    height: 1px;
    background: {text_dark};
    margin: 36px 0 24px;
    opacity: 0.2;
}}

.subtitle {{
    font-size: 13px;
    font-weight: 300;
    color: {muted};
    line-height: 1.7;
    max-width: 460px;
    margin-bottom: 28px;
}}

.meta {{
    font-size: 10px;
    letter-spacing: 0.06em;
    color: {muted};
    margin-top: 4px;
}}
</style>
</head>
<body>
<div class="page">
    <div class="bar"></div>
    <div class="content">
        <div class="eyebrow">{t.get('doc_type','').upper()}</div>
        <div class="title">{t['title']}</div>
        <div class="rule"></div>
        {subtitle_block}
        <div class="meta">{t.get('author','')}{('  ·  ' + t.get('date','')) if t.get('date') else ''}</div>
    </div>
</div>
</body></html>"""


# ── Pattern 6: Stripe — bold horizontal bands ──────────────────────────────────
def _pattern_stripe(t: dict) -> str:
    """
    Page divided into three bold horizontal bands:
    - Top band (accent, ~18%): document type label
    - Middle band (dark, ~52%): large title in white
    - Bottom band (page bg, ~30%): author / date / subtitle
    Hard geometry, no gradients, no textures. Newspaper / brand poster aesthetic.
    """
    top_h    = 200   # accent band
    mid_h    = 580   # dark band
    bot_y    = top_h + mid_h  # 780

    accent   = t["accent"]
    dark     = t.get("cover_bg", "#1A1A2E")
    light    = t.get("page_bg", "#FAFAF8")
    text_l   = t.get("text_light", "#FFFFFF")
    muted    = t.get("muted", "#888888")

    subtitle_block = ""
    if t.get("subtitle"):
        subtitle_block = f'<div class="subtitle">{t["subtitle"]}</div>'

    return f"""<!DOCTYPE html>
<html>
<head><meta charset="UTF-8">
<style>
{_base_css(t)}
html, body {{ background: {light}; }}
.page {{ background: {light}; }}

/* Three bands */
.band-top {{
    position: absolute; top: 0; left: 0;
    width: 794px; height: {top_h}px;
    background: {accent};
    display: flex; align-items: flex-end;
    padding: 0 64px 24px;
}}
.band-mid {{
    position: absolute; top: {top_h}px; left: 0;
    width: 794px; height: {mid_h}px;
    background: {dark};
    display: flex; flex-direction: column; justify-content: center;
    padding: 0 64px;
}}
.band-bot {{
    position: absolute; top: {bot_y}px; left: 0;
    width: 794px; height: {1123 - bot_y}px;
    background: {light};
    display: flex; flex-direction: column; justify-content: center;
    padding: 0 64px;
}}

/* Top band — doc type in large caps */
.eyebrow {{
    font-family: '{t['font_display']}', sans-serif;
    font-size: 11px; font-weight: 700;
    letter-spacing: 0.32em; text-transform: uppercase;
    color: {dark}; opacity: 0.85;
}}

/* Mid band — title */
.title {{
    font-family: '{t['font_display']}', 'Times New Roman', Georgia, serif;
    font-weight: 900;
    font-size: 62px;
    line-height: 0.97;
    color: {text_l};
    letter-spacing: -0.02em;
    max-width: 620px;
    word-wrap: break-word;
}}

/* Thin horizontal separator between mid and bot */
.sep {{
    position: absolute; top: {bot_y}px; left: 0;
    width: 794px; height: 2px;
    background: {accent};
}}

/* Bottom band */
.author {{
    font-size: 13px; font-weight: 500;
    color: {t.get('dark','#111')}; margin-bottom: 4px;
}}
.date   {{ font-size: 11px; color: {muted}; margin-bottom: 12px; }}
.subtitle {{
    font-size: 12px; color: {muted}; line-height: 1.6;
    max-width: 540px;
}}
</style>
</head>
<body>
<div class="page">
    <div class="band-top">
        <div class="eyebrow">{t.get('doc_type','').upper()}</div>
    </div>
    <div class="band-mid">
        <div class="title">{t['title']}</div>
    </div>
    <div class="sep"></div>
    <div class="band-bot">
        <div class="author">{t.get('author','')}</div>
        <div class="date">{t.get('date','')}</div>
        {subtitle_block}
    </div>
</div>
</body></html>"""


# ── Pattern 7: Diagonal — angled color split ───────────────────────────────────
def _pattern_diagonal(t: dict) -> str:
    """
    SVG polygon cuts the page diagonally: upper-left in dark cover color,
    lower-right in light page bg. Title sits on the dark area, metadata on light.
    One angled edge — no gradients, no curves.
    """
    dark_bg  = t.get("cover_bg", "#1B2A4A")
    light_bg = t.get("page_bg", "#FAFCFF")
    accent   = t["accent"]
    text_l   = t.get("text_light", "#F8FAFF")
    text_d   = t.get("dark", "#0F1A2E")
    muted    = t.get("muted", "#7A8A99")

    # Polygon: full upper-left to ~60% down on right side
    # Points: top-left, top-right, (794, 620), (0, 820)
    poly = "0,0 794,0 794,620 0,820"

    subtitle_block = ""
    if t.get("subtitle"):
        subtitle_block = f'<div class="subtitle-lt">{t["subtitle"]}</div>'

    return f"""<!DOCTYPE html>
<html>
<head><meta charset="UTF-8">
<style>
{_base_css(t)}
html, body {{ background: {light_bg}; }}
.page {{ background: {light_bg}; overflow: hidden; }}

/* Title block — upper dark area */
.content-dark {{
    position: absolute;
    left: 64px; right: 64px;
    top: 180px;
    z-index: 2;
}}
.eyebrow {{
    font-size: 9px; font-weight: 500;
    letter-spacing: 0.26em; text-transform: uppercase;
    color: {accent}; margin-bottom: 28px;
}}
.title {{
    font-family: '{t['font_display']}', 'Helvetica Neue', sans-serif;
    font-weight: 900;
    font-size: 58px;
    line-height: 1.0;
    color: {text_l};
    letter-spacing: -0.018em;
    max-width: 560px;
    word-wrap: break-word;
    margin-bottom: 16px;
}}
.rule-accent {{
    width: 52px; height: 3px;
    background: {accent};
    margin-top: 28px;
}}

/* Metadata — lower light area */
.content-light {{
    position: absolute;
    left: 64px; right: 64px;
    bottom: 80px;
    z-index: 2;
}}
.author {{
    font-size: 12px; font-weight: 500;
    color: {text_d}; margin-bottom: 4px;
}}
.date   {{ font-size: 11px; color: {muted}; margin-bottom: 12px; }}
.subtitle-lt {{
    font-size: 12px; color: {muted}; line-height: 1.6;
    max-width: 480px;
}}
</style>
</head>
<body>
<div class="page">
    <!-- Diagonal dark polygon -->
    <svg style="position:absolute;top:0;left:0;width:794px;height:1123px;z-index:1"
         xmlns="http://www.w3.org/2000/svg">
        <polygon points="{poly}" fill="{dark_bg}"/>
        <!-- Accent edge line along the diagonal -->
        <line x1="0" y1="820" x2="794" y2="620"
              stroke="{accent}" stroke-width="2.5"/>
    </svg>

    <div class="content-dark">
        <div class="eyebrow">{t.get('doc_type','').upper()}&nbsp; · &nbsp;{t.get('date','')}</div>
        <div class="title">{t['title']}</div>
        <div class="rule-accent"></div>
    </div>

    <div class="content-light">
        <div class="author">{t.get('author','')}</div>
        {subtitle_block}
    </div>
</div>
</body></html>"""


# ── Pattern 8: Frame — elegant inset border ────────────────────────────────────
def _pattern_frame(t: dict) -> str:
    """
    Classic formal layout: outer thin border line inset ~28px from page edges,
    inner accent strip at top and bottom inside the frame.
    Title centered in the frame space, classical serif typography.
    Used for: academic papers, formal reports, legal docs, annual reports.
    """
    bg      = t.get("cover_bg", "#FAF8F3")
    accent  = t["accent"]
    dark    = t.get("dark", "#2A1A0A")
    muted   = t.get("muted", "#9A8A78")

    pad = 28   # frame inset from page edge
    inner_w = 794 - 2 * pad
    inner_h = 1123 - 2 * pad

    subtitle_block = ""
    if t.get("subtitle"):
        subtitle_block = f'<div class="subtitle">{t["subtitle"]}</div>'

    return f"""<!DOCTYPE html>
<html>
<head><meta charset="UTF-8">
<style>
{_base_css(t)}
html, body {{ background: {bg}; }}
.page {{ background: {bg}; }}

/* Outer frame rectangle */
.frame {{
    position: absolute;
    top: {pad}px; left: {pad}px;
    width: {inner_w}px; height: {inner_h}px;
    border: 1.2px solid {dark};
    opacity: 0.35;
}}

/* Accent strips inside top and bottom of frame */
.frame-top-accent {{
    position: absolute;
    top: {pad + 10}px; left: {pad + 10}px;
    width: {inner_w - 20}px; height: 3px;
    background: {accent};
}}
.frame-bot-accent {{
    position: absolute;
    bottom: {pad + 10}px; left: {pad + 10}px;
    width: {inner_w - 20}px; height: 3px;
    background: {accent};
}}

/* Corner ornament squares */
.corner {{
    position: absolute;
    width: 8px; height: 8px;
    background: {accent};
    opacity: 0.6;
}}
.tl {{ top: {pad - 4}px;  left: {pad - 4}px; }}
.tr {{ top: {pad - 4}px;  right: {pad - 4}px; }}
.bl {{ bottom: {pad - 4}px; left: {pad - 4}px; }}
.br {{ bottom: {pad - 4}px; right: {pad - 4}px; }}

/* Main content centered in frame */
.content {{
    position: absolute;
    left: {pad + 56}px; right: {pad + 56}px;
    top: 0; bottom: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
}}

.eyebrow {{
    font-size: 8.5px;
    font-weight: 500;
    letter-spacing: 0.30em;
    text-transform: uppercase;
    color: {accent};
    margin-bottom: 44px;
}}

.rule-top {{
    width: 60px; height: 1px;
    background: {dark};
    opacity: 0.3;
    margin-bottom: 28px;
}}

.title {{
    font-family: '{t['font_display']}', Georgia, 'Times New Roman', serif;
    font-weight: 400;
    font-size: 44px;
    line-height: 1.25;
    color: {dark};
    letter-spacing: 0.01em;
    max-width: 540px;
    word-wrap: break-word;
    margin-bottom: 0;
}}

.rule-mid {{
    width: 40px; height: 1.5px;
    background: {accent};
    margin: 28px 0 20px;
}}

.subtitle {{
    font-size: 13px;
    font-weight: 300;
    font-style: italic;
    color: {muted};
    line-height: 1.6;
    max-width: 400px;
    margin-bottom: 20px;
}}

.meta {{
    font-size: 10px;
    letter-spacing: 0.08em;
    color: {muted};
    margin-top: 8px;
}}
</style>
</head>
<body>
<div class="page">
    <div class="frame"></div>
    <div class="frame-top-accent"></div>
    <div class="frame-bot-accent"></div>
    <div class="corner tl"></div>
    <div class="corner tr"></div>
    <div class="corner bl"></div>
    <div class="corner br"></div>

    <div class="content">
        <div class="eyebrow">{t.get('doc_type','').upper()}</div>
        <div class="rule-top"></div>
        <div class="title">{t['title']}</div>
        <div class="rule-mid"></div>
        {subtitle_block}
        <div class="meta">{t.get('author','')}{('  ·  ' + t.get('date','')) if t.get('date') else ''}</div>
    </div>
</div>
</body></html>"""

