---
name: ziwei-doushu
description: Professional Ziwei Doushu consultation skill with an offline calculation engine. Use for life palace structure, twelve palaces, four transformations, major luck cycles, yearly triggers, and a clear split between chart facts and traditional interpretation.
---

# Ziwei Doushu

Generate a professional Ziwei Doushu reading with a clear split between chart facts, traditional interpretation, and practical trend summaries.

## Required Workflow

1. Confirm Gregorian birth date, local birth time, gender convention, birthplace, and timezone.
2. Convert local birth time to the standard two-hour branch index and record the conversion.
3. Install the local dependency once in this Skill directory:

```bash
npm install --no-audit --no-fund
```

4. Run the offline engine from this Skill directory:

```bash
node scripts/ziwei_engine_js.mjs --date 1990-10-21 --time-index 8 --gender female --year 2026 --anchor-date 2026-01-01
```

5. Preserve the JSON output as the calculation record, then interpret it with the references listed below.

## Parameters

- `--date YYYY-MM-DD`: Gregorian birth date.
- `--time-index 0-11`: two-hour branch index; `0` is 子时, `1` is 丑时, through `11` for 亥时.
- `--gender male|female|男|女`: gender convention used by the engine.
- `--year YYYY`: optional target year.
- `--anchor-date YYYY-MM-DD`: required with `--year` for annual triggers.

## Calculation Standard

- Calendar input: Gregorian date.
- Time input: explicit branch index derived from local time.
- Engine: local `iztro` JavaScript runtime.
- Output: structured JSON on stdout.
- If daylight saving, timezone, or branch-boundary handling is uncertain, state the uncertainty and calculate alternatives when it can change the result.

## Deliverables

Include:

1. Calculation standard and normalized inputs.
2. Chart facts: 命宫、身宫、十二宫、主星组合、三方四正、四化、大限和流年触发。
3. Interpretation framework: robust signals, timing-sensitive areas, and conflicting indicators.
4. Practical summary: career, relationships, money, energy management, and current-year focus.

## Output Guardrails

- Separate chart facts from traditional interpretation.
- Present conclusions as trends and structures, never deterministic destiny claims.
- Make calculation conventions visible.
- If the engine fails, report the error and stop rather than estimating from memory.
- Do not treat this output as medical, legal, financial, or investment advice.

## Optional HTML Visualization

Use the engine JSON to render a standalone responsive HTML file when requested:

- deep blue background `#0a0e2a`;
- purple highlight `#a890ff` and silver text `#e8e4ff`;
- transformations: 禄 `#ffd66e`, 权 `#ff8eb8`, 科 `#6ee0d6`, 忌 `#b8b4c8`;
- put 命、身、大限、流年 badges inline beside palace names;
- never use absolutely positioned badges that can cover text.

HTML visualization is optional and must not gate the textual report.

## References

- `references/mapping.md`
- `references/interpretation-framework.md`
