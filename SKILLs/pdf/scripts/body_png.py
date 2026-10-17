#!/usr/bin/env python3
"""
body_png.py — Matplotlib-based PNG renderers (math / chart / flowchart).

Split out of render_body.py (issue #1069); re-exported there for compatibility.
All renderers return PNG bytes on success, or None on any failure so callers
can fall back to a plain-text block.
"""

import io

from reportlab.platypus import Image as RLImage


def _image_from_bytes(png_bytes: bytes, usable_w: float,
                      max_frac: float = 0.88) -> RLImage:
    """Create a scaled RLImage from PNG bytes, bounded to max_frac of usable_w."""
    img = RLImage(io.BytesIO(png_bytes))
    max_w = usable_w * max_frac
    if img.drawWidth > max_w:
        scale = max_w / img.drawWidth
        img.drawWidth  = max_w
        img.drawHeight = img.drawHeight * scale
    return img


def _render_math_png(expr: str, dpi: int = 180) -> bytes | None:
    """
    Render a LaTeX math expression via matplotlib mathtext.
    No LaTeX binary required — uses matplotlib's built-in math parser.
    Supports: fractions (\\frac), integrals (\\int), sums (\\sum),
              Greek letters, sub/superscripts, etc.
    """
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        fig = plt.figure(figsize=(8, 1.2))
        fig.patch.set_facecolor("white")
        ax = fig.add_axes([0, 0, 1, 1])
        ax.set_axis_off()
        ax.set_facecolor("white")
        ax.text(0.5, 0.5, f"${expr}$",
                fontsize=16, ha="center", va="center",
                transform=ax.transAxes)
        buf = io.BytesIO()
        fig.savefig(buf, format="png", dpi=dpi, bbox_inches="tight",
                    facecolor="white", pad_inches=0.1)
        plt.close(fig)
        buf.seek(0)
        return buf.read()
    except Exception:
        return None


def _render_chart_png(item: dict, accent: str, dpi: int = 150) -> bytes | None:
    """
    Render bar / line / pie chart to PNG using matplotlib.

    Required fields:
        chart_type   "bar" | "line" | "pie"  (default "bar")
        labels       list of category strings
        datasets     list of {label?, values: list[number]}

    Optional fields:
        title        chart title
        x_label      X-axis label
        y_label      Y-axis label
    """
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        import matplotlib.colors as mcolors
        import colorsys
        import numpy as np

        chart_type = item.get("chart_type", "bar")
        title_text = item.get("title", "")
        labels     = item.get("labels", [])
        datasets   = item.get("datasets", [])

        # Derive a consistent palette from the document accent color
        r, g, b = mcolors.to_rgb(accent)
        h, s, v = colorsys.rgb_to_hsv(r, g, b)
        palette = [
            colorsys.hsv_to_rgb(
                (h + i * 0.13) % 1.0,
                max(0.35, s - i * 0.08),
                min(0.92, v + i * 0.04),
            )
            for i in range(max(len(datasets), 1))
        ]

        fig, ax = plt.subplots(figsize=(7, 3.6), dpi=dpi)
        fig.patch.set_facecolor("white")
        ax.set_facecolor("white")

        if chart_type == "bar":
            x = np.arange(len(labels))
            n = max(len(datasets), 1)
            width = 0.68 / n
            for i, ds in enumerate(datasets):
                offset = (i - (n - 1) / 2) * width
                ax.bar(x + offset, ds.get("values", []), width * 0.88,
                       label=ds.get("label", f"Series {i+1}"),
                       color=palette[i % len(palette)], edgecolor="none")
            ax.set_xticks(x)
            ax.set_xticklabels(labels, fontsize=8.5)
            ax.yaxis.grid(True, alpha=0.25, color="#CCCCCC", linewidth=0.7)
            ax.set_axisbelow(True)
            if item.get("x_label"):
                ax.set_xlabel(item["x_label"], fontsize=8.5)
            if item.get("y_label"):
                ax.set_ylabel(item["y_label"], fontsize=8.5)

        elif chart_type == "line":
            x = np.arange(len(labels))
            for i, ds in enumerate(datasets):
                ax.plot(x, ds.get("values", []), marker="o", markersize=3.5,
                        label=ds.get("label", f"Series {i+1}"),
                        color=palette[i % len(palette)], linewidth=1.8)
            ax.set_xticks(x)
            ax.set_xticklabels(labels, fontsize=8.5)
            ax.yaxis.grid(True, alpha=0.25, color="#CCCCCC", linewidth=0.7)
            ax.set_axisbelow(True)
            if item.get("x_label"):
                ax.set_xlabel(item["x_label"], fontsize=8.5)
            if item.get("y_label"):
                ax.set_ylabel(item["y_label"], fontsize=8.5)

        elif chart_type == "pie":
            vals   = datasets[0].get("values", []) if datasets else []
            colors = [
                colorsys.hsv_to_rgb(
                    (h + i * 0.11) % 1.0,
                    max(0.30, s - i * 0.06),
                    min(0.92, v + i * 0.03),
                )
                for i in range(len(vals))
            ]
            ax.pie(vals, labels=labels, colors=colors,
                   autopct="%1.1f%%", pctdistance=0.82,
                   wedgeprops=dict(edgecolor="white", linewidth=1.4),
                   textprops=dict(fontsize=8.5))

        # Shared styling
        for spine in ax.spines.values():
            spine.set_linewidth(0.5)
            spine.set_color("#CCCCCC")
        ax.tick_params(axis="both", length=0, labelsize=8.5)
        if title_text:
            ax.set_title(title_text, fontsize=10, pad=8,
                         color="#333333", fontweight="bold")
        if len(datasets) > 1 and chart_type != "pie":
            ax.legend(frameon=False, fontsize=8, loc="upper right")

        plt.tight_layout(pad=0.4)
        buf = io.BytesIO()
        fig.savefig(buf, format="png", dpi=dpi, bbox_inches="tight",
                    facecolor="white", pad_inches=0.06)
        plt.close(fig)
        buf.seek(0)
        return buf.read()
    except Exception:
        return None


def _render_flowchart_png(item: dict, accent: str, dark: str,
                           muted: str, dpi: int = 130) -> bytes | None:
    """
    Render a top-to-bottom flowchart using matplotlib patches and arrows.

    Node schema:  {id, label, shape?}
        shape: "rect" (default) | "diamond" | "oval" | "parallelogram"

    Edge schema:  {from, to, label?}
        Forward edges (to a later node) draw straight arrows.
        Back edges (to an earlier node) draw a curved arc to the right.
    """
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        import matplotlib.patches as mpatch
        from matplotlib.patches import FancyBboxPatch
        import matplotlib.colors as mcolors

        nodes_list = item.get("nodes", [])
        edges      = item.get("edges", [])
        if not nodes_list:
            return None

        nodes = {n["id"]: n for n in nodes_list}
        order = {n["id"]: i for i, n in enumerate(nodes_list)}

        n_nodes = len(nodes_list)
        BOX_W   = 4.2
        BOX_H   = 0.58
        STEP_Y  = 1.25
        CX      = 5.0

        fig_h = max(3.5, n_nodes * STEP_Y + 0.8)
        fig, ax = plt.subplots(figsize=(6, fig_h), dpi=dpi)
        fig.patch.set_facecolor("white")
        ax.set_facecolor("white")
        ax.set_xlim(0, 10)
        ax.set_ylim(-0.6, n_nodes * STEP_Y + 0.2)
        ax.invert_yaxis()
        ax.axis("off")

        acc_rgb   = mcolors.to_rgb(accent)
        dark_rgb  = mcolors.to_rgb(dark)
        muted_rgb = mcolors.to_rgb(muted)

        # Node positions (cx, cy) — preserves input order
        pos = {nid: (CX, i * STEP_Y) for nid, i in order.items()}

        # ── Draw edges (behind nodes) ──────────────────────────────────────────
        for edge in edges:
            src, dst = edge.get("from"), edge.get("to")
            if src not in pos or dst not in pos:
                continue
            x1, y1 = pos[src]
            x2, y2 = pos[dst]
            lbl = edge.get("label", "")

            src_shape = nodes.get(src, {}).get("shape", "rect")
            dst_shape = nodes.get(dst, {}).get("shape", "rect")
            dy_src = BOX_H * (0.80 if src_shape == "diamond" else 0.50)
            dy_dst = BOX_H * (0.80 if dst_shape == "diamond" else 0.50)

            y_start = y1 + dy_src
            y_end   = y2 - dy_dst

            # Forward edge: straight; back-edge: curved arc
            conn = "arc3,rad=0.0" if y_end > y_start + 0.01 else "arc3,rad=0.42"

            ax.annotate("",
                xy=(x2, y_end), xytext=(x1, y_start),
                arrowprops=dict(
                    arrowstyle="-|>", color=muted_rgb,
                    lw=1.0, mutation_scale=10,
                    connectionstyle=conn,
                ),
            )
            if lbl:
                mid_x = (x1 + x2) / 2 + 0.28
                mid_y = (y_start + y_end) / 2
                ax.text(mid_x, mid_y, lbl, fontsize=7.5,
                        color=muted_rgb, ha="left", va="center")

        # ── Draw nodes (in front of edges) ────────────────────────────────────
        for nid, (cx, cy) in pos.items():
            node  = nodes[nid]
            shape = node.get("shape", "rect")
            label = node.get("label", nid)
            left  = cx - BOX_W / 2
            bot   = cy - BOX_H / 2

            if shape in ("oval", "terminal"):
                el = mpatch.Ellipse(
                    (cx, cy), BOX_W * 0.78, BOX_H * 1.15,
                    facecolor=acc_rgb, edgecolor=acc_rgb, linewidth=0,
                )
                ax.add_patch(el)
                ax.text(cx, cy, label, ha="center", va="center",
                        fontsize=8.5, fontweight="bold", color="white")

            elif shape == "diamond":
                d = BOX_W * 0.44
                diamond = plt.Polygon(
                    [(cx, cy - d * 0.72), (cx + d, cy),
                     (cx, cy + d * 0.72), (cx - d, cy)],
                    facecolor="#FFFCF0",
                    edgecolor=accent, linewidth=1.2,
                )
                ax.add_patch(diamond)
                ax.text(cx, cy, label, ha="center", va="center",
                        fontsize=8, color=dark_rgb)

            elif shape == "parallelogram":
                skew = 0.30
                para = plt.Polygon(
                    [(left + skew, bot), (left + BOX_W + skew, bot),
                     (left + BOX_W, bot + BOX_H), (left, bot + BOX_H)],
                    facecolor="white",
                    edgecolor=accent, linewidth=1.2,
                )
                ax.add_patch(para)
                ax.text(cx, cy, label, ha="center", va="center",
                        fontsize=8.5, color=dark_rgb)

            else:   # rect (default)
                rect = FancyBboxPatch(
                    (left, bot), BOX_W, BOX_H,
                    boxstyle="round,pad=0.04",
                    facecolor="white",
                    edgecolor=accent, linewidth=1.2,
                )
                ax.add_patch(rect)
                ax.text(cx, cy, label, ha="center", va="center",
                        fontsize=8.5, color=dark_rgb)

        plt.tight_layout(pad=0.2)
        buf = io.BytesIO()
        fig.savefig(buf, format="png", dpi=dpi, bbox_inches="tight",
                    facecolor="white", pad_inches=0.08)
        plt.close(fig)
        buf.seek(0)
        return buf.read()
    except Exception:
        return None
