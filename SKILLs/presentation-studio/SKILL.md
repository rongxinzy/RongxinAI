---
name: presentation-studio
description: "The only skill for creating a new PowerPoint deck. Builds a source-backed story and visual system, writes a native editable DeckSpec, blocks export on layout warnings, and compiles a verified PPTX. Triggers: create, generate, design, or lay out a new PPT, PPTX, PowerPoint, presentation, slide deck, pitch deck, report deck, training deck, or slides. Do not use to read or modify an existing PPTX."
license: MIT
metadata:
  version: "1.0"
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
    validation.json
```

`deck.json` owns the canvas, theme, text styles, and page order. Every page owns only its editable elements. Do not duplicate theme values across pages.

## Required workflow

1. **Audit material and audience.** Read supplied material completely. Record facts, sources, dates, assumptions, and gaps in `outline.md`. Each page must have one action title and one takeaway.
2. **Choose a mode.** Use summary mode for complete source material, outline mode for a supplied page plan, search mode only when research is needed. Choose reference mode when the user supplied visual references; otherwise choose creative mode.
3. **Choose a visual direction before creating any page.** Read [Creative mode](references/creative-mode.md) and the matching scenario profile in [Profiles](references/profiles.md). For supplied visual references, read [Reference mode](references/reference-mode.md) instead. Create three concise direction cards, select one against the audience and content, then write `design.md`: profile, anchor, color rationale, font pair, type scale, grid, image strategy, chart/table treatment, layout families, and deck-specific forbidden patterns. Never default to a remembered palette, purple-blue gradients, rounded-card grids, or whitespace used as a substitute for composition.
4. **Create three proof pages first:** cover, representative content page, and data/diagram page. Render/inspect them with the available visual capability and revise the design contract before expanding the deck.
5. **Create `deck.json`, then pages in order.** Use only the documented DeckSpec fields. Use native `text`, `shape`, `image`, `table`, and `chart` elements; do not rasterize an entire page. Declare semantic colors and explicitly style non-text elements: a mask, rule, panel, table, or chart must not silently inherit one global primary color. Images are required where the design contract calls for visual storytelling. Use high-quality, relevant assets; never replace missing imagery with a placeholder or an unrelated gradient.
6. **Validate, fix, validate.** Run the validator in strict mode. A warning is a real presentation defect unless explicitly listed as an intentional exception in `design.md`. Do not export until validation reports zero errors and zero warnings.
7. **Compile and inspect the final PPTX.** Confirm the file exists and is non-empty. Render the final PPTX when a renderer is available and inspect every page—not merely the source preview.

## Tooling

Inside ZhiYuan/Pi, use `run_skill_script` for the validator and compiler so PowerPoint export
does not depend on a user-installed Node.js. The skill's local `node_modules` remains the
dependency boundary; the app supplies the Node-compatible runtime.

Install the compiler dependency once per bundled skill copy:

```bash
npm install --prefix "<SKILL_DIR>" # packaging/runtime setup only
```

Validate before every export:

```json
{
  "skillId": "presentation-studio",
  "script": "scripts/validate-deck.mjs",
  "args": ["<deck-dir>/deck.json", "--strict", "--json", "<deck-dir>/output/validation.json"]
}
```

Compile only after a clean validation:

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
      "body": { "fontSize": 20, "fontFace": "Microsoft YaHei", "color": "$text", "lineHeight": 1.35 }
    }
  },
  "pages": ["pages/01-cover.json"]
}
```

Each page is `{ "pageType": "cover|content|chapter|final", "background": "#...", "elements": [...] }`. Elements require a unique `id`, a `type`, and `bounds: [x, y, width, height]` in canvas pixels. Supported types are `text`, `shape`, `image`, `table`, and `chart`; the compiler intentionally fails closed for unsupported element types. See [DeckSpec styling](references/deckspec-styling.md) before using masks, image overlays, chart series, or tables.

### Text element

```json
{
  "id": "cover-title",
  "type": "text",
  "bounds": [96, 220, 800, 140],
  "style": "$title",
  "text": "A decisive action title",
  "align": "left",
  "valign": "mid",
  "wrap": true
}
```

### Shape and image elements

```json
{ "id": "rule", "type": "shape", "shape": "rect", "bounds": [96, 386, 120, 8], "fill": "$accent" }
{ "id": "hero-mask", "type": "shape", "shape": "rect", "bounds": [880, 0, 400, 720], "fill": "$primary", "fillTransparency": 38, "decorative": true }
{ "id": "hero", "type": "image", "src": "assets/hero.jpg", "bounds": [880, 0, 400, 720], "sizing": "cover" }
```

### Table and chart elements

```json
{ "id": "metrics", "type": "table", "bounds": [96, 420, 520, 180], "rows": [["Metric", "Result"], ["Revenue", "42%"]], "fontSize": 18, "headerFill": "$primary", "headerColor": "$background", "borderColor": "$muted" }
{ "id": "trend", "type": "chart", "chartType": "bar", "bounds": [660, 390, 520, 230], "data": [{ "name": "Growth", "labels": ["Q1", "Q2"], "values": [18, 42] }], "colors": ["$primary"] }
```

## Non-negotiable quality gates

- Use 16:9 unless the user requires another format.
- Minimum body size is 18pt; captions may be 12pt; no text below 12pt.
- Do not use more than three font families. Color count follows the selected direction; every semantic color must have an allocated role in `design.md`.
- All non-decorative elements must remain inside the canvas and respect the declared safe margin.
- Text overflow, text-text occlusion, unsafe margins, unintentional underfill, missing assets, invalid colors, duplicate IDs, and unsupported elements block export.
- For decks of 20+ pages, workers may generate only assigned page files after `outline.md`, `design.md`, and `deck.json` are locked. The lead validates and exports the complete deck once.

## Visual evaluation

Before changing this skill, use the six prompts in [evaluation suite](examples/evaluation/README.md). Compare rendered cover, content, and data pages with the current baseline using [the visual rubric](references/visual-review.md). A clean validator result proves editability, not taste.

## Delivery

Report the deck title, page count, visual decisions, source/assumption notes, validation result, and absolute paths to `presentation.pptx` and `validation.json`. A generated file without clean validation is not a delivery.
