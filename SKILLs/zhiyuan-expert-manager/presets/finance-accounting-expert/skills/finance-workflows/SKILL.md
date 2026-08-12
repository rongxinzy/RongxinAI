---
name: finance-workflows
description: Coordinate multi-step finance and accounting work across financial statements, journal entries, reconciliations, close, audit support, and variance analysis. Use when a request spans multiple finance processes or needs a controlled workpaper plan.
---

# Finance Workflows

Use this skill as the controller for multi-process finance work. For a single process, route to the more specific skill.

## Control framework

1. Confirm entity, period, currency, unit, ledger, accounting framework, materiality, and due date.
2. Inventory source files with system, owner, extraction time, version, and approval state.
3. Create a data lineage table from each reported number to source, transformation, formula, and reviewer.
4. Sequence work by dependencies: data freeze, subledger close, entries, reconciliations, trial balance, statements, variance review, sign-off.
5. Route to `financial-statements`, `journal-entry-prep`, `reconciliation`, `close-management`, `audit-support`, or `variance-analysis`.
6. Maintain one issue log with amount, account, root cause, impact, owner, due date, status, and escalation.
7. Finish with cross-process checks and a sign-off pack.

## Required controls

- opening balance + activity = closing balance;
- total debits = total credits;
- subledger totals = control accounts;
- statement subtotals and cross-statement links reconcile;
- current-period data uses one cut-off and one exchange-rate policy;
- all manual adjustments have support, approval, and reversal treatment where applicable;
- unresolved items are visible and assessed against materiality.

Do not claim close, approval, posting, audit completion, or compliance certification without evidence. Use `xlsx`, `docx`, or `pdf` only after reading that skill from `<available_skills>`.
