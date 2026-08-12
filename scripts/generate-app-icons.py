#!/usr/bin/env python3
"""Generate the cross-platform ZhiYuan application icon set.

Requires Pillow. The generated PNG, ICO, and ICNS files are committed so
packaging jobs do not need to regenerate them.
"""

from pathlib import Path

from PIL import Image, ImageDraw


PROJECT_ROOT = Path(__file__).resolve().parent.parent
SOURCE_LOGO = PROJECT_ROOT / "public" / "zhiyuan-logo-light-1600.png"
PNG_DIR = PROJECT_ROOT / "build" / "icons" / "png"
WINDOWS_ICON = PROJECT_ROOT / "build" / "icons" / "win" / "icon.ico"
MAC_ICON = PROJECT_ROOT / "build" / "icons" / "mac" / "icon.icns"
MASTER_ICON = PROJECT_ROOT / "build" / "icons" / "app-icon-master.png"

CANVAS_SIZE = 1024
ICON_BOUNDS = (64, 64, 960, 960)
ICON_RADIUS = 220
# Windows desktop and shortcut icons do not add reliable padding themselves.
# Keep the same inset as the shared master icon so the visible mark is not
# oversized next to other Windows applications.
WINDOWS_ICON_BOUNDS = ICON_BOUNDS
WINDOWS_ICON_RADIUS = ICON_RADIUS
PNG_SIZES = (16, 24, 32, 48, 64, 128, 256, 512, 1024)
ICO_SIZES = ((16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256))


def make_gradient() -> Image.Image:
    # Match the official website: cool white paper fading into a soft blue glow.
    top = (255, 255, 255)
    bottom = (237, 245, 255)
    gradient = Image.new("RGBA", (CANVAS_SIZE, CANVAS_SIZE))
    pixels = gradient.load()

    for y in range(CANVAS_SIZE):
        vertical = y / (CANVAS_SIZE - 1)
        for x in range(CANVAS_SIZE):
            horizontal = x / (CANVAS_SIZE - 1)
            blend = min(1.0, vertical * 0.76 + horizontal * 0.24)
            base = tuple(
                round(top[channel] * (1 - blend) + bottom[channel] * blend)
                for channel in range(3)
            )

            glow_x = (x - 760) / 540
            glow_y = (y - 800) / 500
            glow = max(0.0, 1.0 - (glow_x * glow_x + glow_y * glow_y))
            accent = (108, 165, 255)
            accent_strength = glow * 0.14
            pixels[x, y] = tuple(
                round(base[channel] * (1 - accent_strength) + accent[channel] * accent_strength)
                for channel in range(3)
            ) + (255,)

    return gradient


def make_master_icon(bounds: tuple[int, int, int, int], radius: int) -> Image.Image:
    canvas = Image.new("RGBA", (CANVAS_SIZE, CANVAS_SIZE), (0, 0, 0, 0))
    mask = Image.new("L", (CANVAS_SIZE, CANVAS_SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle(bounds, radius=radius, fill=255)

    canvas.alpha_composite(Image.composite(make_gradient(), Image.new("RGBA", canvas.size), mask))

    border = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(border).rounded_rectangle(
        bounds,
        radius=radius,
        outline=(208, 213, 221, 210),
        width=12,
    )
    canvas.alpha_composite(border)

    logo = Image.open(SOURCE_LOGO).convert("RGBA")
    alpha = logo.getchannel("A")
    bounding_box = alpha.getbbox()
    if bounding_box is None:
        raise RuntimeError(f"Logo has no visible pixels: {SOURCE_LOGO}")

    wordmark = logo.crop(bounding_box)
    logo_width = 748
    logo_height = round(wordmark.height * logo_width / wordmark.width)
    wordmark = wordmark.resize((logo_width, logo_height), Image.Resampling.LANCZOS)

    position = ((CANVAS_SIZE - logo_width) // 2, (CANVAS_SIZE - logo_height) // 2 + 8)
    canvas.alpha_composite(wordmark, position)
    return canvas


def main() -> None:
    PNG_DIR.mkdir(parents=True, exist_ok=True)
    WINDOWS_ICON.parent.mkdir(parents=True, exist_ok=True)
    MAC_ICON.parent.mkdir(parents=True, exist_ok=True)

    master = make_master_icon(ICON_BOUNDS, ICON_RADIUS)
    windows_master = make_master_icon(WINDOWS_ICON_BOUNDS, WINDOWS_ICON_RADIUS)
    master.save(MASTER_ICON, optimize=True)

    for size in PNG_SIZES:
        resized = master.resize((size, size), Image.Resampling.LANCZOS)
        resized.save(PNG_DIR / f"{size}x{size}.png", optimize=True)

    windows_master.save(WINDOWS_ICON, format="ICO", sizes=ICO_SIZES)
    master.save(MAC_ICON, format="ICNS")

    print(f"Generated application icon master: {MASTER_ICON}")
    print(f"Generated Windows icon: {WINDOWS_ICON}")
    print(f"Generated macOS icon: {MAC_ICON}")


if __name__ == "__main__":
    main()
