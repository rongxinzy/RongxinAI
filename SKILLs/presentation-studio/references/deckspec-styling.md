# DeckSpec styling

Use semantic colors defined in `deck.json`; do not reuse another deck's hex values.

- `shape`: require `fill`, `line`, or `gradient`. Optional `fillTransparency` and `lineTransparency` are 0–100; use a translucent rectangle over an image as an editable mask. Optional `lineWidth`, `lineDash`, and `rotate` support rules and framing. A background ornament may extend beyond the canvas only when both `decorative: true` and `allowOverflow: true` are declared; content may never use this escape hatch.
- `gradient`: use only on a `rect`: `{ "from": "$primary", "to": "$background", "direction": "horizontal", "steps": 12 }`. It compiles to editable native rectangle bands, so use it for a deliberate cover field or image edge fade—not a default decoration.
- `text`: optional `italic`, `charSpacing`, `margin`, and `rotate` support editorial hierarchy. Keep body text readable.
- `image`: use `cover` or `contain`; optional `transparency` is for intentional layering only.
- `table`: declare `headerFill`, `headerColor`, `borderColor`, `borderWidth`, and `fill` when the visual contract calls for them. A table must not inherit the primary color by accident.
- `chart`: declare `colors` for every multi-series chart. Use `series1`, `series2`, and `series3` or more direction-specific series tokens; do not use one hue for unrelated series.

All visual effects remain editable native objects. Use transparent overlays instead of rasterising masks.
