#!/usr/bin/env node
// Generates the quick-case preview sites and quick-action catalogues. The
// implementation lives in scripts/quick-case-sites/, split by responsibility:
// context (paths + inputs), html/styles/shell (shared page scaffolding),
// pages/ (per-skill page generators), prompts + catalogue (prompt text and
// catalogue output), and main (orchestration).
import './quick-case-sites/main.mjs';
