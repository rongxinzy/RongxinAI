---
name: reconciliation
description: Reconcile general ledger accounts to subledgers, bank statements, schedules, or intercompany balances. Use for account reconciliations, exception classification, aging, adjusting recommendations, and sign-off workpapers.
---

# Reconciliation

## Procedure

1. Confirm both sources use the same entity, account, currency, unit, and as-of date.
2. Preserve source balances and calculate the opening difference before matching.
3. Match by stable keys where available, then by controlled combinations of amount, date, reference, and counterparty.
4. Separate exact matches, one-to-many/many-to-one matches, and unmatched items; never force a match to reach zero.
5. Classify exceptions:
   - timing difference expected to clear;
   - adjustment required in the ledger or source system;
   - unresolved item requiring investigation.
6. Age open items into 0-30, 31-60, 61-90, and over-90-day buckets unless policy specifies otherwise.
7. Reconcile source balance + identified adjustments to the target balance and prove the residual.

## Specialized checks

- Bank: outstanding payments, deposits in transit, fees, interest, returned items, bank and book errors.
- GL to subledger: manual control-account entries, failed interfaces, batch timing, reclasses, and mapping errors.
- Intercompany: counterpart entity, document, currency, FX rate, cut-off, dispute, and elimination status.

## Workpaper

Include purpose, sources, balances, matching logic, reconciling items, aging, proposed entries, evidence links, owner, due date, escalation, conclusion, preparer, and reviewer. An unexplained residual cannot be marked reconciled.
