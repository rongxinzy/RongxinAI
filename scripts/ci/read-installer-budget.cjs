// Pass paths as argv: Windows PowerShell 5 strips quotes from node -e strings.
const path = require('node:path');
const [root, edition] = process.argv.slice(2);
if (!root || !['lite', 'cpu', 'cuda'].includes(edition)) {
  throw new Error('Usage: read-installer-budget.cjs <project root> <lite|cpu|cuda>');
}
const budget = require(path.resolve(root, 'scripts/installer-shell/distribution-budget.cjs'));
process.stdout.write(
  JSON.stringify({
    setup: budget.resolveEditionSetupBudget(edition),
    nsis: budget.resolveEditionNsisBudget(edition),
  }),
);
