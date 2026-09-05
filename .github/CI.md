# CI gate ownership

Every PR runs lint, renderer type checking/build/bundle budgets, Electron compilation,
unit tests, and Presentation Studio tests. Documentation-only PRs retain these baseline
checks in this first rollout. Unknown paths never skip the baseline.

`scripts/ci/gates/policy.ts` owns expensive-check selection:

| Change                                                                                                      | Additional PR checks                                                        |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Dependencies, patches, build/configuration, workflows, scripts, bundled runtimes, Skills/MCPs, main process | Linux install/startup, Windows install/upgrade/uninstall, memory regression |
| Renderer services, hooks, store, application entry points, cowork UI, shared conversation components        | Memory regression                                                           |
| Other renderer UI, styles, documentation                                                                    | None                                                                        |

The planner uses the full Git merge-base diff, with NUL-separated paths and rename
detection disabled. Deleted paths and both sides of renames participate. Invalid SHAs
or diff failures stop the planner; no API pagination or 300-file filter limit applies.

`merge-gate` always runs and rejects failed, cancelled, missing, or unexpectedly skipped
required jobs. Linux and Windows workflows are reusable/manual workflows, so they do
not create duplicate PR runs. The parent CI owns concurrency cancellation.

## Release and nightly checks

Candidate builds run memory regression against the resolved candidate commit before
platform packaging. Candidate quality also runs renderer type checking/bundle budgets
and Presentation Studio tests. The Linux job installs and starts the exact candidate
deb before assembling its payload; unpacked renderer verification is retained.
Windows signing, runtime, install/upgrade/uninstall checks remain mandatory.

Nightly uses the same memory scenario with additional MemLab analysis. Tag publishing
retains mandatory memory regression through reusable CI; its own platform jobs still
own packaging. Main pushes repeat baseline checks without duplicate installation jobs.

After this workflow is available on main, use **CI → Run workflow** on a selected branch
to force all expensive checks. Individual Linux/Windows manual workflows remain available.
Manual checks supplement the PR checks; they do not replace the PR merge-commit check.

## Required-check rollout and measurement

After a real PR run confirms the `merge-gate` check name, configure it as a required
status check in the main ruleset. Do not require the conditional platform jobs directly.
This change does not modify repository rules or production environment permissions.

Before rollout, the sampled successful PR runs had Linux median 16.2 minutes and CI
median 6.3 minutes (short sample from September 4, 2026; queue time included). These
are reference observations, not a performance guarantee.

Compare one week before/after, separately for ordinary and packaging/lifecycle PRs:

- PR ready-for-merge median/P95 and queue versus execution time.
- Expensive jobs selected, skipped, failed, and cancelled; runner minutes per PR.
- Candidate failures attributable to checks deferred from PR, and resulting rework.

Initial target: ordinary PR feedback in 5–8 minutes without increased release rework.
If deferred checks repeatedly find regressions in an unclassified area, expand its path
ownership. Do not reduce the mandatory candidate checks to improve this metric.
