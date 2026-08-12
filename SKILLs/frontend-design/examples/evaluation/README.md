# Visual evaluation suite

For every prompt, create three direction cards, choose one, and save a desktop/mobile preview plus a build report. Compare revised output with the previous baseline blind; target at least 70% preference while preserving interaction, accessibility, responsiveness, and delivery evidence.

To prepare anonymous pairs, place `baseline.json` and `candidate.json` in each task folder (each declares `{ "kind": "website", "preview": "desktop.png" }`) and run `node scripts/prepare-visual-blind-review.mjs <evaluation-root> --seed <run-id>`. Give reviewers only the generated form and artifacts; keep the review key sealed until all votes are recorded.

1. `01-architect-portfolio.md` — high-end editorial portfolio.
2. `02-community-garden.md` — civic and organic information hub.
3. `03-museum-evenings.md` — nocturnal cultural event.
4. `04-logistics-console.md` — dense operations control surface.
5. `05-food-maker.md` — tactile small-business showcase.
6. `06-learning-lab.md` — playful educational tool.
7. `07-research-archive.md` — quiet searchable archive.
8. `08-mobility-service.md` — precise premium service landing page.
