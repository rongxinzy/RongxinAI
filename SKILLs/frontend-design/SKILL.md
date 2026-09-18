---
name: frontend-design
description: Create distinctive, production-grade frontend interfaces with high design quality. Use this skill when the user asks to build web components, pages, artifacts, posters, or applications (examples include websites, landing pages, dashboards, React components, HTML/CSS layouts, or when styling/beautifying any web UI). Generates creative, polished code and UI design that avoids generic AI aesthetics.
license: Complete terms in LICENSE.txt
metadata:
  version: "1.0"
  category: design
  sources:
    - https://github.com/anthropics/skills
---

This skill guides creation of distinctive, production-grade frontend interfaces that avoid generic "AI slop" aesthetics. Implement real working code with exceptional attention to aesthetic details and creative choices. Do not begin from a remembered palette, component library, or hero layout.

The user provides frontend requirements: a component, page, application, or interface to build. They may include context about the purpose, audience, or technical constraints.

## Visual direction workflow

1. Read [the design brief](references/design-brief.md). Extract audience, brand cues, content density, platform, accessibility needs, and one memorable interaction or composition.
2. Select three materially different directions from [design archetypes](references/design-archetypes.md). A direction changes composition, typography, color temperature, and motion—not only the accent color.
3. Record the chosen direction in `design.md` before implementation: the discarded alternatives, anchor, palette roles, typography, spacing scale, component treatment, image strategy, responsive changes, motion budget, and context-specific prohibitions.
4. When screenshots or an approved site are supplied, use [reference mode](references/reference-mode.md) before selecting a direction. Extract a design system; never copy protected logos, artwork, or a page screenshot.
5. Build the hero and one representative dense section first. Render desktop and mobile, review with [the visual rubric](references/visual-review.md), revise the contract, then complete the site.

## Case templates（案例模板）

`templates/` holds complete, self-contained reference implementations that ship with this skill.

Each template is a single offline-safe HTML file with one strict split:

- **Structure, CSS and interaction are frozen.** The `<style>` block and the body skeleton are the design. Do not rewrite them.
- **All copy, numbers and color roles live in one `TEMPLATE` object** at the top of the `<script>` block, inside the region marked `可编辑区`. A render layer underneath fills the DOM from it.
- **Each template ships an `info.md`** next to it holding the field table, per-field length limits, design prohibitions and asset rules. Read that file before editing.

Workflow when the user picks a case: read the template file, read its `info.md`, copy the HTML file as the deliverable, then change **only** the `TEMPLATE` object. Keep the section order, grid, type scale and interaction model. Hue and type may be tuned within the same design language; do not swap in a different direction, and never ship the sample copy.

| Template | Direction | Fits | Contract |
| --- | --- | --- | --- |
| `templates/web-product-launch.html` | Swiss grid: strictly aligned columns, hairline rules, oversized numerals, high-contrast neutrals with one signal color, square shapes | product launch pages, technical explainers | `templates/web-product-launch.info.md` |
| `templates/web-ops-console.html` | Low-noise console: light ground with white panels, semantic status colors, exception-first data hierarchy, tabular numerals | operations dashboards, admin panels, monitoring | `templates/web-ops-console.info.md` |
| `templates/web-resume.html` | Editorial resume: paper ground, oversized serif name, letterspaced role line, ruled entry grid, hairline skill bars | personal resumes, portfolios, freelance profiles | `templates/web-resume.info.md` |
| `templates/web-store.html` | Craft catalog: cool bone ground, olive and brick accent pair, CSS-drawn vessel still life with an overlapping info card, ruled group headings, dotted price leaders | ceramics, cafés, bakeries, florists, local retail | `templates/web-store.info.md` |
| `templates/web-event.html` | Night invitation: plum-black ground with one rose accent, centered narrow measure, four-unit countdown, ruled schedule, underlined fields | birthdays, weddings, house warmings, RSVP pages | `templates/web-event.info.md` |
| `templates/web-survey.html` | Focused form document: sticky hairline progress bar, numbered questions, drawn choice marks, square fields | questionnaires, intake forms, sign-ups | `templates/web-survey.info.md` |
| `templates/web-game-snake.html` | Phosphor arcade: near-black olive ground, one mint accent, canvas board with a gradient snake and eyes, three speed steps, run history | single-file mini-games, arcade interaction | `templates/web-game-snake.info.md` |
| `templates/web-game-2048.html` | Slate board with a single-hue cobalt tile ladder, fluid cell size, live score and best, one-step undo, ladder legend | number-merging and grid puzzle games | `templates/web-game-2048.info.md` |
| `templates/web-game-typing.html` | Typing drill: cool paper ground, one deep teal accent, monospace passage with per-character states, metric strip, result card | typing drills, speed tests, text games | `templates/web-game-typing.info.md` |

Templates constrain visual and structural direction only. Content, data, and brand names must come from the request. Every template is offline-safe: no external requests and no webfonts. Two game templates read and write one best-score key in `localStorage`; every such call is wrapped in `try/catch`, because the in-app artifact preview runs the file in a sandboxed iframe where storage access throws. Keep both properties in any variant you build.

For cases without a template, choose a direction from [design archetypes](references/design-archetypes.md) as before.

## Design Thinking

Before coding, understand the context and commit to a BOLD aesthetic direction:
- **Purpose**: What problem does this interface solve? Who uses it?
- **Tone**: Pick an extreme: brutally minimal, maximalist chaos, retro-futuristic, organic/natural, luxury/refined, playful/toy-like, editorial/magazine, brutalist/raw, art deco/geometric, soft/pastel, industrial/utilitarian, etc. There are so many flavors to choose from. Use these for inspiration but design one that is true to the aesthetic direction.
- **Constraints**: Technical requirements (framework, performance, accessibility).
- **Differentiation**: What makes this UNFORGETTABLE? What's the one thing someone will remember?

**CRITICAL**: Choose a clear conceptual direction and execute it with precision. Bold maximalism and refined minimalism both work - the key is intentionality, not intensity.

Then implement working code (HTML/CSS/JS, React, Vue, etc.) that is:
- Production-grade and functional
- Visually striking and memorable
- Cohesive with a clear aesthetic point-of-view
- Meticulously refined in every detail

## Frontend Aesthetics Guidelines

Focus on:
- **Typography**: Choose fonts that are beautiful, unique, and interesting. Avoid generic fonts like Arial and Inter; opt instead for distinctive choices that elevate the frontend's aesthetics; unexpected, characterful font choices. Pair a distinctive display font with a refined body font.
- **Color & Theme**: Commit to a cohesive aesthetic. Use CSS variables for consistency. Dominant colors with sharp accents outperform timid, evenly-distributed palettes.
- **Motion**: Use animations for effects and micro-interactions. Prioritize CSS-only solutions for HTML. Use Motion library for React when available. Focus on high-impact moments: one well-orchestrated page load with staggered reveals (animation-delay) creates more delight than scattered micro-interactions. Use scroll-triggering and hover states that surprise.
- **Spatial Composition**: Unexpected layouts. Asymmetry. Overlap. Diagonal flow. Grid-breaking elements. Generous negative space OR controlled density.
- **Backgrounds & Visual Details**: Create atmosphere and depth rather than defaulting to solid colors. Add contextual effects and textures that match the overall aesthetic. Apply creative forms like gradient meshes, noise textures, geometric patterns, layered transparencies, dramatic shadows, decorative borders, custom cursors, and grain overlays.

NEVER use generic AI-generated aesthetics like overused font families (Inter, Roboto, Arial, system fonts), cliched color schemes (particularly purple gradients on white backgrounds), predictable layouts and component patterns, and cookie-cutter design that lacks context-specific character.

Interpret creatively and make unexpected choices that feel genuinely designed for the context. No design should be the same. Vary between light and dark themes, different fonts, different aesthetics. NEVER converge on common choices (Space Grotesk, for example) across generations.

**IMPORTANT**: Match implementation complexity to the aesthetic vision. Maximalist designs need elaborate code with extensive animations and effects. Minimalist or refined designs need restraint, precision, and careful attention to spacing, typography, and subtle details. Elegance comes from executing the vision well.

Remember: you are capable of extraordinary creative work. Don't hold back, show what can truly be created when thinking outside the box and committing fully to a distinctive vision.

## Evaluation suite

Before changing this skill, run the eight prompts in [the evaluation suite](examples/evaluation/README.md). For each, retain the brief, direction cards, desktop/mobile previews, build result, and rubric score. A build passing is a delivery prerequisite, not visual evidence.

## Delivery Gate

Build or otherwise run the finished interface, inspect the rendered result,
and save a nonempty `.md`, `.txt`, or `.json` validation report in the
workspace. Capture at least one inspected `.png`, `.jpg`, or `.jpeg`
rendered preview. The controlled Website shortcut completes only after
`workflow_state` records an existing HTML deliverable (role `deliverable`),
then that validation report (role `validation`, with `deliverablePath` set to
the HTML file), and the preview (role `preview`, with the same
`deliverablePath`). Never end after a design explanation or code sketch.
