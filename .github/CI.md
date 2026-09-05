# CI gate ownership

Every PR runs workflow validation, lint, renderer type checking/build/bundle budgets, Electron compilation,
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

The main ruleset requires `merge-gate` from GitHub Actions (app ID 15368), with the
branch up to date before merging. This was enabled on September 5, 2026 after verifying
the merged workflow's real check. Existing role bypasses remain unchanged; they can
still bypass this requirement. Do not require conditional platform jobs directly.

The lint job checks all workflows with actionlint 1.7.12 before installing application
dependencies. Its Linux binary is verified against a pinned SHA-256. This validates
workflow syntax, expressions, reusable-workflow inputs and job dependencies; ShellCheck
is not enabled by this gate.

## Security audit operation

Weekly/manual Security Scan audits the root `bun.lock` using Bun 1.4.0. It audits
every tracked nested Skill package and other child projects with npm lockfiles in
isolated report directories. Existing locks are copied unchanged; lockless Skills
resolve a fresh dependency graph with lifecycle scripts disabled. Their reports are
labelled `unlocked-resolution` and are not evidence of the exact graph in a shipped
installer. Root development dependencies are included because build tools and some
bundled runtime dependencies live there.

High/critical findings and audit/registry failures return nonzero. All child projects
are attempted even if one fails; JSON reports, stderr, copied locks and a summary TSV
are uploaded on failure as well as success. Artifact retention is three days, matching
the repository's effective Actions retention setting. A red audit with valid findings
requires vulnerability triage; it must not be silenced with an unconditional success.
Known vulnerability remediation is separate from repairing the scanning mechanism.
This full scheduled scan is not an additional heavy PR gate.

Reproduce child audits with `bash scripts/ci/audit-npm-projects.sh /tmp/npm-audit-report`.

## Latency measurement

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
