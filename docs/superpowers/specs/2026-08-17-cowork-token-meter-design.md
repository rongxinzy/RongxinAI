# Cowork Token Meter Design

## Goal

Adapt the DeepSeek Harness context meter and session statistics design for the
shared Cowork prompt input. Work mode and direct chat must render the same
controls and consume one renderer-facing statistics shape.

## Data

Both transports update a shared session statistics snapshot.

- Always collect rounds, model steps, model request duration, tool duration,
  and time to first visible text token from local runtime boundaries.
- Accumulate input, output, cache-read, and cache-write tokens only when the
  provider reports verified usage.
- Derive cache-hit percentage only when reliable input-side usage exists.
- Keep the latest verified context usage as the meter's total reading.
- Estimate system prompt, tool definitions, and conversation composition
  locally. Every estimated figure is visibly prefixed with `~` and is not
  treated as a billing total.
- Preserve existing persisted context and usage metadata. New timing fields
  are available only for newly produced messages; historic sessions are not
  backfilled with guessed measurements.

## Interface

Use the existing shadcn/ui primitives:

- `Popover` for a click-open context detail surface.
- `Button` for the context meter trigger.
- `Progress` for the occupancy bar.
- `Tooltip` for the meter and a truncated statistics line.
- `Separator` for context detail grouping when needed.

The meter remains at the prompt input's existing trailing position. It uses a
small inline SVG only for the circular progress visualization. Clicking the
trigger, clicking outside, or pressing Escape closes the detail surface.

The context detail surface shows the percentage, approximate used/capacity,
an occupancy bar, and optional estimated system, tools, and messages rows.
It falls back to a single-color bar if composition data is unavailable.

The prompt input footer renders one no-wrap statistics line:

`rounds and steps | model and tool duration | TTFT and throughput | cache hit | input and output`

Each group is omitted when its prerequisites are unavailable. Overflow uses
ellipsis and enables the full-value tooltip only when the line is clipped.

## Reliability

Only finite, non-negative measurements enter the snapshot. Failed, aborted,
or incomplete steps may contribute stable counts, but do not contribute a
latency or throughput measurement without complete boundaries. Missing usage
never renders as a zero token or zero cache reading.

## Verification

Add test-first coverage for metrics aggregation, cache-hit calculation,
missing-usage suppression, TTFT/tool timing, popover close behavior, and
truncation tooltip gating. Run the affected Vitest files, `git diff --check`,
lint, and manual Electron checks in both Cowork modes, themes, and a narrow
window.
