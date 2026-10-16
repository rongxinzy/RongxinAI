# CI gate ownership

Every PR runs workflow validation, lint, renderer type checking/build/bundle budgets, Electron compilation,
unit tests, and Presentation Studio tests. Documentation-only and website-only PRs keep these baseline
checks. They do not run install, memory, enterprise toolchain, or channel-runtime smoke jobs.
Unknown paths never skip the baseline. Unit tests run as four shards of one `test` job; `merge-gate`
still requires that job to succeed.

`scripts/ci/gates/policy.ts` owns expensive-check selection:

| Change                                                                                                      | Additional PR checks                                                        |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Dependencies, patches, build/configuration, workflows, scripts, bundled runtimes, Skills/MCPs, main process | Memory regression. Linux and Windows install run on tags, manual dispatch, and release workflows |
| Renderer services, hooks, store, application entry points, cowork UI, shared conversation components        | Memory regression                                                           |
| Other renderer UI, styles, documentation, website                                                           | None                                                                        |

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

## Windows PR latency

PR installation checks retain installer size, clean-PATH runtime probes, cold install,
cache-hit upgrade and uninstall. Compression qualification runs on manual and weekly
Windows builds, and is mandatory before both candidate assembly and tag publication.
The shared action retains its JSON report and enforces the existing size, extraction
time, content identity and Python import criteria.

PRs only restore packaging caches; they do not archive and upload them after testing.
Monday's Windows build (02:23 UTC) and manual builds on main save missing cache entries
after all installation checks succeed. Other branches never write the shared cache.
The restore/save paths and key match; frozen dependency installation still runs on a
cache hit. Before the first successful main warmup, PRs can run cold. A cache miss
affects speed only and does not skip installation or verification.

The reference Windows job in run 33942412961 took 22m11s: compression qualification
was 3m28s and cache saving was 3m50s (662 MB compressed cache, mostly local archiving
time). The next-run acceptance target is under 17 minutes with every retained gate
passing. Record restore time and cache hit/miss alongside the final duration; a single
run is directional evidence, not a median/P95 claim. If the target is missed, report
the miss and investigate the measured bottleneck without relaxing installation tests.

## Required-check rollout and measurement

The default branch requires `ci-gate` and retains `merge-gate` from GitHub Actions
(app ID 15368), with the branch up to date before merging. `ci-gate` validates the
PR title/body and aggregates applicable workflows at the current head;
`.github/devops-ci.json` records their triggers. `merge-gate` retains application
job validation. Do not require conditional platform jobs directly.

All PRs, including documentation, require one independent GitHub approval. New
commits dismiss stale approvals; the latest push must be approved by another person.
Resolve review threads before merging. Only repository administrators may bypass review through a pull request; other
roles may not. CI, force-push and deletion rules have no administrator bypass. The former author-specific
`author-review-gate` is replaced by these uniform server-side review requirements.

See [DEVOPS.md](../DEVOPS.md) for PR titles, descriptions, bug-fix evidence and the
[team Project](https://github.com/orgs/rongxinzy/projects/2) for owners and status.

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

Before the October 16, 2026 streamlining, 19 successful pull request CI runs
(October 15–16) had a median workflow wall clock of 349 seconds, including runner
queue. The 12 runs that finished in under 10 minutes had a median of 328 seconds.
The execution critical path was the `test` job (median 309 seconds: about 79 seconds
of Electron `tsc` plus about 200 seconds of Vitest) followed by `merge-gate` (median
8 seconds). `memory-leak`, when selected (14 of 19), ran in parallel at a median of
169 seconds and was not the critical path. Lint median was 27 seconds and
bundle-budget (renderer typecheck, Vite build, budget) was 37 seconds. `ci-gate`,
the only required status check, tracked CI and had a median of 355 seconds on 6
successful samples. Channel runtime smoke median was 14 seconds and ran on every PR.

These are measured samples, not a performance guarantee. Sharding and TypeScript
cache hits change the critical path; a cold TypeScript cache still pays for one
full Electron compile on each shard.

Compare one week before/after, separately for ordinary and packaging/lifecycle PRs:

- PR ready-for-merge median/P95 and queue versus execution time.
- Expensive jobs selected, skipped, failed, and cancelled; runner minutes per PR.
- Candidate failures attributable to checks deferred from PR, and resulting rework.

Initial target: ordinary PR feedback in 5–8 minutes without increased release rework.
If deferred checks repeatedly find regressions in an unclassified area, expand its path
ownership. Do not reduce the mandatory candidate checks to improve this metric.
