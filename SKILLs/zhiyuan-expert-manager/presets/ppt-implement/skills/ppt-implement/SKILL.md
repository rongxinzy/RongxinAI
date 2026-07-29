---
name: ppt-implement
description: Create or revise editable HTML-based PowerPoint presentations, including story structure, slide implementation, screenshots, validation, and PPTX export. Use for PPT, slide deck, pitch deck, training deck, or presentation production requests.
---

# PPT Implement

Create an editable presentation project from source material and export a verified PPTX. Follow this file in order. Do not rely on lifecycle hooks or environment variables.

## Runtime Paths

- `SKILL_DIR`: the directory containing this `SKILL.md` (`dirname(<location>)` from the available Skill entry).
- `WORKSPACE_DIR`: an absolute directory dedicated to the presentation project.
- Resolve every relative path in this file against `SKILL_DIR`, never against the application repository.
- Quote both paths in every command.

## Explicit Tool Entry Points

```bash
# Initialize the project and install required dependencies.
node "<SKILL_DIR>/scripts/setup-project.js" "<WORKSPACE_DIR>"

# Synchronize routing metadata after writing or changing one slide.
node "<SKILL_DIR>/scripts/post-slide.js" "<WORKSPACE_DIR>" "<WORKSPACE_DIR>/frontend/src/slides/slide-1.js"

# Build the web presentation and export an editable PPTX.
node "<SKILL_DIR>/scripts/export-ppt.js" "<WORKSPACE_DIR>"

# Capture every rendered page after a successful build.
node "<SKILL_DIR>/scripts/screenshot-cover.js" "<WORKSPACE_DIR>"
```

The scripts are idempotent. Run them explicitly; Pi does not execute legacy SessionStart, PreToolUse, PostToolUse, or Stop hooks.

## Project Layout

```text
<WORKSPACE_DIR>/
  docs/
    project.json
    product/
      material.md
      chapters.md
      style.md
  frontend/
    index.html
    public/assets/images/
    src/slides/slide-N.js
    src/styles/main.css
  artifacts/
    index.html
    presentation.pptx
    screenshots/page-N.png
```

Do not alter framework files unless a verified framework defect blocks the requested result. Normal work belongs in `docs/product/`, `frontend/src/slides/`, `frontend/src/styles/main.css`, and `frontend/public/assets/`.

## Workflow

### Phase 1: Audit the Request and Sources

1. Identify audience, venue, core message, language, page count, brand constraints, and required output.
2. Read all user-provided source files before drafting.
3. Create `<WORKSPACE_DIR>/docs/product/material.md` with:
   - source name, URL or file path;
   - publication or reporting date;
   - facts and data points;
   - usable quotations or visuals;
   - `[MISSING]` items and explicit assumptions.
4. Never invent company, customer, market, financial, or research data. If external research is unavailable, build the deck from supplied material and label gaps.

### Phase 2: Build the Story

Use a structure appropriate to the request:

| Deck type        | Default narrative                                       |
| ---------------- | ------------------------------------------------------- |
| Business report  | conclusion -> evidence -> detail -> next action         |
| Product or sales | problem -> solution -> value -> proof -> call to action |
| Pitch deck       | situation -> complication -> question -> answer         |
| Training         | foundation -> method -> example -> practice -> recap    |
| Conference talk  | hook -> argument -> evidence -> synthesis -> close      |

Write `<WORKSPACE_DIR>/docs/product/chapters.md`. For every page include:

- page number and page type;
- an action title that states the takeaway;
- supporting content and data;
- visual or chart requirement;
- narrative role;
- source references and unresolved gaps.

Apply MECE where useful. One page communicates one main idea. Default to 10-16 pages if the user gives no page count, adjusting to source depth.

### Phase 3: Define the Visual System

Write `<WORKSPACE_DIR>/docs/product/style.md` with:

- 16:9 canvas and safe margins;
- no more than three font families;
- primary, neutral, and semantic colors;
- title, body, caption, and data-label scales;
- grid, spacing, card, chart, icon, and image rules;
- accessibility targets for contrast and minimum text size.

Use images only when they carry information or materially improve comprehension. Prefer editable charts, shapes, and text over screenshots. Use only image tools currently available to the runtime; otherwise use user assets, properly sourced images, or native layout elements.

### Phase 4: Initialize

Run:

```bash
node "<SKILL_DIR>/scripts/setup-project.js" "<WORKSPACE_DIR>"
```

Verify these paths exist before continuing:

- `<WORKSPACE_DIR>/docs/project.json`
- `<WORKSPACE_DIR>/frontend/index.html`
- `<WORKSPACE_DIR>/frontend/src/slides/`
- `<WORKSPACE_DIR>/artifacts/`

If dependency installation fails, report the command and error. Do not claim the project can build until dependencies are available.

### Phase 5: Select Templates

Template references live under `references/templates/`. Read only the indexes and template files needed for the selected page types:

- `references/templates/cover/cover-pages-index.md`
- `references/templates/toc/toc-pages-index.md`
- `references/templates/transition/transition-pages-index.md`
- `references/templates/content/content-pages-index.md`
- `references/templates/ending/ending-pages-index.md`

Use a template as a layout reference, then adapt it to the actual content and visual system. Do not force dense content into an incompatible template.

### Phase 6: Implement Slides

Create sequential files at `<WORKSPACE_DIR>/frontend/src/slides/slide-N.js` using this contract:

```javascript
window.slideDataMap.set(
  1,
  `<div style="width: 1440px; height: 810px; overflow: hidden;">
    <!-- editable slide content -->
  </div>`,
);
```

Rules:

1. Keep the slide canvas fixed at 1440 x 810 and prevent overflow.
2. Use semantic HTML, editable text, CSS layout, and chart primitives.
3. Keep all slide-local content inside the outer container.
4. Put shared design tokens and reusable styles in `frontend/src/styles/main.css`.
5. Store images in `frontend/public/assets/images/` and reference them as `/assets/images/<file>`.
6. Keep page numbers continuous and aligned with `chapters.md`.
7. After every created or modified slide, run:

```bash
node "<SKILL_DIR>/scripts/post-slide.js" "<WORKSPACE_DIR>" "<absolute-slide-file>"
```

For large decks, slides with no content dependency may be authored in parallel, but each worker must receive the relevant chapter entry, style specification, slide contract, and output path. Review the complete deck afterward for consistency.

### Phase 7: Validate Content and Layout

Before export, check every page for:

- one clear takeaway and accurate supporting content;
- no clipped, overflowing, overlapping, or off-canvas elements;
- consistent typography, spacing, alignment, and color use;
- legible labels, units, legends, and source notes;
- correct image paths and aspect ratios;
- continuous page order and matching chapter outline;
- explicit labels for assumptions and missing data.

### Phase 8: Build and Export

Run:

```bash
node "<SKILL_DIR>/scripts/export-ppt.js" "<WORKSPACE_DIR>"
```

The command synchronizes slide imports, builds the HTML artifact, builds static slide HTML, and converts it to `<WORKSPACE_DIR>/artifacts/presentation.pptx`. Treat any nonzero exit as a failed export.

Verify both files exist and are nonempty:

- `<WORKSPACE_DIR>/artifacts/index.html`
- `<WORKSPACE_DIR>/artifacts/presentation.pptx`

### Phase 9: Screenshot QA

Run:

```bash
node "<SKILL_DIR>/scripts/screenshot-cover.js" "<WORKSPACE_DIR>"
```

Inspect all files under `<WORKSPACE_DIR>/artifacts/screenshots/`. If a page is blank, clipped, overlapping, inconsistent, or unreadable, fix the slide and repeat Phases 7-9.

### Phase 10: Deliver

Report:

- deck title and page count;
- story and visual-system decisions;
- sources, assumptions, and unresolved `[MISSING]` items;
- validation performed;
- absolute paths to `presentation.pptx`, `index.html`, and screenshots.

Do not claim that an artifact was created unless its file exists and passed the corresponding check.

## Revision Workflow

When the user requests changes to an existing generated project:

1. Read `material.md`, `chapters.md`, `style.md`, and only the affected slide files.
2. Preserve the established visual system unless the user requests a redesign.
3. Modify the smallest necessary set of files.
4. Run `post-slide.js` for each changed slide.
5. Repeat validation, export, and screenshot QA.

## Failure Rules

- If a required source is missing, mark it `[MISSING]` and continue only when a defensible partial result is possible.
- If setup or export dependencies cannot install, provide the exact failing command and stop before claiming success.
- If an external image or font cannot load, replace it with a local or system-safe alternative.
- If PPTX conversion rejects an element, simplify that element to editable text, shapes, tables, or supported images and retry.
