# Visual evaluation suite

Use each prompt for a cover, a representative content page, and a data or diagram page. Run every prompt three times when comparing a change; unrelated runs must not collapse to the same palette or layout family.

1. `01-mineral-energy-transition.md` — strategic proposal, restrained and material.
2. `02-night-museum-membership.md` — cultural brand launch, image-led.
3. `03-river-ecology-classroom.md` — middle-school explainer, vivid but readable.
4. `04-healthcare-evidence-review.md` — academic defense, evidence-dense.
5. `05-artisan-food-portfolio.md` — portfolio showcase, warm editorial.
6. `06-logistics-exception-report.md` — operations report, information-dense.

For each run save `design.md`, rendered proof pages, validation output, and a rubric score. Compare against the pre-change baseline blind; target a 70% preference rate without losing validation, editability, or legibility.

To prepare the render pairs for human review, put a `baseline.json` and `candidate.json` in each task folder (each declares `{ "kind": "ppt", "preview": "rendered-cover.png" }`) and run:

```bash
node scripts/prepare-visual-blind-review.mjs <evaluation-root> --seed <run-id>
```

Give reviewers only `blind-review/review-form.json` and `blind-review/artifacts/`; protect `blind-review/blind-review-key.json` until reviews are complete.
