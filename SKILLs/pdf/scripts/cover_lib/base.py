"""Shared helpers for cover rendering (split from cover.py, issue #1069)."""


# ── Google Fonts loader ────────────────────────────────────────────────────────
def _gfonts_import(t: dict) -> str:
    """Return a CSS @import for the document's Google Fonts, if available."""
    url = t.get("gfonts_import", "")
    if url:
        return f"@import url('{url}');"
    return ""


# ── Shared CSS head (required by all patterns) ─────────────────────────────────
def _base_css(t: dict) -> str:
    """Critical reset + shared variables. Never remove these rules."""
    return f"""
{_gfonts_import(t)}
* {{ margin: 0; padding: 0; box-sizing: border-box; }}
html, body {{
    width: 794px; height: 1123px;
    overflow: hidden;
    background: {t['cover_bg']};
    font-family: '{t['font_body']}', 'Helvetica Neue', Helvetica, Arial, sans-serif;
}}
.page {{
    position: relative;
    width: 794px; height: 1123px;
    background: {t['cover_bg']};
    overflow: hidden;
}}
"""


# ── Dot-grid SVG helper ─────────────────────────────────────────────────────────
def _dot_grid(x0, y0, cols, rows, *, gap, r, color, opacity) -> str:
    """Render a dot-grid as an absolutely positioned SVG element."""
    dots = []
    for row in range(rows):
        for col in range(cols):
            cx = x0 + col * gap
            cy = y0 + row * gap
            dots.append(f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{color}"/>')
    return (
        f'<svg style="position:absolute;top:0;left:0;width:794px;height:1123px;'
        f'pointer-events:none;opacity:{opacity}" xmlns="http://www.w3.org/2000/svg">'
        + "".join(dots) + "</svg>"
    )


# ── Cross-hatch SVG helper ──────────────────────────────────────────────────────
def _cross_hatch(color, opacity, spacing=32, stroke_w=0.5) -> str:
    lines = []
    for i in range(-20, 60):
        x = i * spacing
        lines.append(f'<line x1="{x}" y1="0" x2="{x + 1200}" y2="1200" stroke="{color}" stroke-width="{stroke_w}"/>')
    return (
        f'<svg style="position:absolute;top:0;left:0;width:794px;height:1123px;'
        f'pointer-events:none;opacity:{opacity};overflow:hidden" xmlns="http://www.w3.org/2000/svg">'
        + "".join(lines) + "</svg>"
    )

