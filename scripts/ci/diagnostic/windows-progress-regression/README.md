# Windows progress-regression diagnostic package

Frozen from Git commit **`977abbf023dfb8cbb3cf998b1d4e09e66ec86655`** (failed preflight [run 42340332484](https://github.com/rongxinzy/RongxinAI/actions/runs/42340332484), job **128306426233**). Self-contained; does not need the full RongxinAI repo.

## One command (Windows sandbox / VM)

From an elevated or interactive **Windows** session, extract the zip and run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Run-ProgressRegressionDiagnostic.ps1 -Mode Both -MaxSeconds 120
```

Outputs land under `out\run-<utc>\`:

| File | Meaning |
|------|---------|
| `environment.json` | Session/desktop metadata (SESSIONNAME, SessionId, `query user`, OS) |
| `original.summary.json` / `*.stdout.log` / `*.stderr.log` | Reproduction of **unmodified** harness (paths only adjusted for standalone layout) |
| `diagnostic.events.jsonl` | NDJSON trace: `get_window_rect_failed` with **immediate** `Marshal.GetLastWin32Error()`, HWND, PID, child index |
| `diagnostic.summary.json` | Exit code + whether PASS line appeared |
| `report.json` | Machine-readable rollup |

Exit code: `0` only if every executed variant exits `0`; otherwise `1`. Processes named `ProgressFixture` and temp dirs `zhiyuan-progress-*` are killed in `finally`.

## Layout

- `original/` — `windows-installer-progress-regression.ps1`, `windows-installer-ui.cs`, `windows-installer-progress-fixture.cs` (from SHA above; `scripts/ci/` paths rewritten to `$PSScriptRoot`).
- `diagnostic/` — same fixture + regression flow; `windows-installer-ui-diagnostic.cs` adds **observation only** (no relaxed asserts). Regression entry: `windows-installer-progress-regression-diagnostic.ps1`.

## Falsifiable hypotheses (do not fix in this package)

| ID | If true on sandbox, you should see |
|----|-----------------------------------|
| **H1 — stale LastError** | `original` fails with message containing `environment option` (203); `diagnostic` shows `get_window_rect_failed` with **`lastError` ≠ 203** (e.g. 1400 invalid handle) on the same HWND |
| **H2 — genuine rect failure** | `diagnostic` shows `get_window_rect_failed` with a **real** Win32 code (5, 1400, 87, …) and stable failing `childIndex` on first `Controls` pass in mode `clean` |
| **H3 — invalid HWND** | `is_window_false` event before `get_window_rect_failed` |
| **H4 — headless / session** | `environment.json` shows non-interactive session (`SESSIONNAME` empty or `Services`) **and** H1/H2 reproduce; interactive desktop re-run differs |

## Source-cause note (not proven on this VM)

Upstream `Inspect` uses `throw new Win32Exception()` after failed `GetWindowRect` without passing `Marshal.GetLastWin32Error()` ([`windows-installer-ui.cs` L114](https://github.com/rongxinzy/RongxinAI/blob/977abbf023dfb8cbb3cf998b1d4e09e66ec86655/scripts/ci/windows-installer-ui.cs#L114)). GHA surfaced **203** (`ERROR_ENVVAR_NOT_FOUND`), which may be **misleading** if LastError was stale. The diagnostic variant does **not** change pass/fail criteria except using `throw new Win32Exception(err)` after rect failure.

## Not in scope

No secrets, no network, no GitHub Actions trigger, no PR commits. **Linux/cloud agent has not run this package** — no reproduction claimed until a Windows box runs the command above.
