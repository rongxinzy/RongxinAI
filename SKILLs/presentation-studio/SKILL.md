---
name: presentation-studio
description: "Create a new PowerPoint deck from a source-backed story and visual system. Write a native editable DeckSpec and compile it directly to PPTX. Triggers: create, generate, design, or lay out a new PPT, PPTX, PowerPoint, presentation, slide deck, pitch deck, report deck, training deck, or slides. Do not use to read or modify an existing PPTX."
license: MIT
metadata:
  version: "1.0.2"
  category: productivity
---

# Presentation Studio

This is the sole workflow for a new deck. Never generate a deck from raw HTML/CSS, screenshots, or a generic Office library. The source of truth is a **DeckSpec** project that compiles directly to editable PowerPoint elements.

## Project contract

Create an isolated project directory:

```text
<deck-dir>/
  outline.md                 # narrative and source contract
  design.md                  # visual contract
  deck.json                  # canvas, theme, and ordered page list
  pages/
    01-cover.json
    02-...json
  assets/                    # local images used by pages
  output/
    presentation.pptx
```

`deck.json` owns the canvas, theme, text styles, and page order. Every page owns only its editable elements. Do not duplicate theme values across pages.

## Required workflow

1. **Audit material and audience.** Read supplied material completely. Record facts, sources, dates, assumptions, and gaps in `outline.md`. Each page must have one action title and one takeaway.
2. **Choose a mode.** Use summary mode for complete source material, outline mode for a supplied page plan, search mode only when research is needed. Choose reference mode when the user supplied visual references; otherwise choose creative mode.
3. **Choose a visual direction before creating any page.** Read [Creative mode](references/creative-mode.md) and the matching scenario profile in [Profiles](references/profiles.md). For supplied visual references, read [Reference mode](references/reference-mode.md) instead. Create three concise direction cards, select one against the audience and content, then write `design.md`: profile, anchor, color rationale, font pair, type scale, grid, image strategy, chart/table treatment, layout families, and deck-specific forbidden patterns. Never default to a remembered palette, purple-blue gradients, rounded-card grids, or whitespace used as a substitute for composition.
4. **Create `deck.json`, then pages in order.** Use native `text`, `shape`, `image`, `table`, and `chart` elements; do not rasterize an entire page. Declare semantic colors and explicitly style non-text elements: a mask, rule, panel, table, or chart must not silently inherit one global primary color. Images are required where the design contract calls for visual storytelling. Use high-quality, relevant assets; never replace missing imagery with a placeholder or an unrelated gradient.
5. **Compile and deliver the PPTX.** Run `scripts/compile-deck.mjs` with the DeckSpec path and the requested output path, then return the generated presentation.

## Tooling

Inside ZhiYuan/Pi, use `run_skill_script` for the compiler so PowerPoint export
does not depend on a user-installed Node.js. The skill's local `node_modules` remains the
dependency boundary; the app supplies the Node-compatible runtime.

Install the compiler dependency once per bundled skill copy:

```bash
npm install --prefix "<SKILL_DIR>" # packaging/runtime setup only
```

Compile directly:

```json
{
  "skillId": "presentation-studio",
  "script": "scripts/compile-deck.mjs",
  "args": ["<deck-dir>/deck.json", "<deck-dir>/output/presentation.pptx"]
}
```

## DeckSpec minimum schema

```json
{
  "title": "Deck title",
  "canvas": { "width": 1280, "height": 720 },
  "theme": {
    "colors": {
      "background": "#…", "surface": "#…", "text": "#…", "muted": "#…",
      "primary": "#…", "secondary": "#…", "accent": "#…",
      "series1": "#…", "series2": "#…", "series3": "#…"
    },
    "textStyles": {
      "title": { "fontSize": 48, "fontFace": "Aptos Display", "color": "$primary", "bold": true },
      "body": { "fontSize": 20, "fontFace": "Microsoft YaHei", "color": "$text" }
    }
  },
  "pages": ["pages/01-cover.json"]
}
```

Each page is `{ "pageType": "cover|content|chapter|final", "background": "#...", "elements": [...] }`. Elements have an `id`, a `type`, and `bounds: [x, y, width, height]` in canvas pixels. Supported types are `text`, `shape`, `image`, `table`, and `chart`. See [DeckSpec styling](references/deckspec-styling.md) before using masks, image overlays, chart series, or tables.

### Text element

```json
{
  "id": "cover-title",
  "type": "text",
  "bounds": [96, 220, 800, 140],
  "style": "$title",
  "text": "A decisive action title",
  "align": "left",
  "valign": "mid"
}
```

### Shape and image elements

```json
{ "id": "rule", "type": "shape", "shape": "rect", "bounds": [96, 386, 120, 8], "fill": "$accent" }
{ "id": "hero-mask", "type": "shape", "shape": "rect", "bounds": [880, 0, 400, 720], "fill": "$primary", "fillTransparency": 38 }
{ "id": "hero", "type": "image", "src": "assets/hero.jpg", "bounds": [880, 0, 400, 720], "sizing": "cover" }
```

### Table and chart elements

```json
{ "id": "metrics", "type": "table", "bounds": [96, 420, 520, 180], "rows": [["Metric", "Result"], ["Revenue", "42%"]], "fontSize": 18, "headerFill": "$primary", "headerColor": "$background", "borderColor": "$muted" }
{ "id": "trend", "type": "chart", "chartType": "bar", "bounds": [660, 390, 520, 230], "data": [{ "name": "Growth", "labels": ["Q1", "Q2"], "values": [18, 42] }], "colors": ["$primary"] }
```

## Design guidance

- Use 16:9 unless the user requires another format.
- Minimum body size is 18pt; captions may be 12pt; no text below 12pt.
- Do not use more than three font families. Color count follows the selected direction; every semantic color must have an allocated role in `design.md`.
- Keep content inside the canvas with consistent margins.
- For decks of 20+ pages, workers may generate assigned page files after `outline.md`, `design.md`, and `deck.json` are established. The lead compiles the complete deck.

## Delivery

Report the deck title, page count, visual decisions, source/assumption notes, and absolute path to `presentation.pptx`.
