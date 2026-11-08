# Round 2 — bare PowerShell vs Vitest (frozen `977abbf02`)

Preflight failure: vitest arm in [run 42340332484](https://github.com/rongxinzy/RongxinAI/actions/runs/42340332484), not the isolated package harness (round 1 passed on `windows-latest`).

## Arms (same job, same runner, sequential, cleanup between)

| ID | What | Falsifies if … |
|----|------|----------------|
| **A** `bare-package` | `powershell -File original/windows-installer-progress-regression.ps1`, cwd `original/`, default `$ProjectRoot` | N/A (baseline from round 1) |
| **B** `spawn-vitest-parity` | Same argv as vitest `spawnSync`: `-File scripts/ci/windows-installer-progress-regression.ps1 -ProjectRoot <workspace>` | **H9 cwd/ProjectRoot**: A passes, B fails → repo-root layout matters |
| **C** `vitest-single` | `bunx vitest run --maxWorkers=1 -t "distinguishes real cross-process"` on `scripts/ci/windows-installer-interactive.test.ts` | **H5/H6**: B passes, C fails → node/vitest parent or module load differs from bare spawn |
| **D** `vitest-bundle12` (optional input) | Same 12-file list as `windows-installer-pr.yml` validate step | **H6 ordering**: C passes, D fails → earlier suites pollute desktop/LastError |

## Success criteria (orchestration)

- `toolchain.json` + `comparison.report.json` + per-arm `*.summary.json` uploaded.
- Each arm: **process exit code** is authoritative (`0` = pass); `passLine` logged as `stdoutPassLine` only; mismatch flagged, never upgrades failure to pass.
- Job workflow step **continues on error** so a reproduced failure still uploads artifacts.

## Notes

- Frozen `original/windows-installer-interactive.test.ts` is renamed `*.frozen-977abbf02` so root `vitest` discovery does not load it (missing `windows-installer-interactive.ps1` in package).
- Arm C uses only `scripts/ci/windows-installer-interactive.test.ts` (production path).

## Not claimed

- Passing all arms does **not** prove preflight root cause fixed (runner/time variance).
- Failing arm does **not** mandate a product fix this PR (report only).
