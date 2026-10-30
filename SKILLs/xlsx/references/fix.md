# FIX — Repair Broken Formulas in an Existing xlsx

This is an EDIT task. You MUST preserve all original sheets and data. Never create a new workbook.

## Workflow

```bash
# Step 1: Read the workbook and locate the formula the user wants repaired
python3 SKILL_DIR/scripts/xlsx_reader.py input.xlsx --json

# Step 2: Unpack
python3 SKILL_DIR/scripts/xlsx_unpack.py input.xlsx /tmp/xlsx_work/

# Step 3: Fix each broken <f> element in the worksheet XML using the Edit tool
#   (see Error-to-Fix mapping below)

# Step 4: Pack
python3 SKILL_DIR/scripts/xlsx_pack.py /tmp/xlsx_work/ output.xlsx
```

## Error-to-Fix Mapping

| Error | Fix Strategy |
|-------|-------------|
| `#DIV/0!` | Wrap: `IFERROR(original_formula, "-")` |
| `#NAME?` | Fix misspelled function (e.g. `SUMM` → `SUM`) |
| `#REF!` | Reconstruct the broken reference |
| `#VALUE!` | Fix type mismatch |


## Critical Rules

- The output MUST contain the same sheets as the input. Do NOT create a new workbook.
- Only modify the specific `<f>` elements that are broken — everything else must be untouched.
