# CI gate scripts

## Daily `ci-gate` (`ci.yml`)

`verify.ts` aggregates parallel baseline jobs (`lint`, `typecheck`, `test` shards). Release verification loads the **latest** `ci.yml` workflow run for the source SHA and requires that run’s `ci-gate` job to succeed.

## Release candidate proof (`release.yml`)

Verifier entrypoint: `verify-release-candidate-readiness.mjs` → `verify-release-candidate-api.ts`.

### GitHub REST evidence

The Actions **job** REST object does **not** include workflow job `outputs` (only `steps`, `status`, `conclusion`, etc.). See [Get a job for a workflow run](https://docs.github.com/en/rest/actions/workflow-jobs) and the recorded fixture `fixtures/github-rest-actions-job-200.json` (live `GET /actions/jobs/128290989210`, 2026-11-07).

Preflight **cannot** resolve `source-ref` from the job outputs API. Instead, the `source` job uploads a run-scoped **`release-preflight-source`** artifact immediately after checkout (before heavy jobs). Release verification reads that artifact from each candidate run’s **run-scoped** artifact list only.

### Checks

1. Latest green `ci.yml` + `ci-gate` on `SOURCE_COMMIT`.
2. Newest eligible `workflow_dispatch` `release-preflight.yml` run on `main` / `release/**` where the run-scoped **source record** names `SOURCE_COMMIT`, `includePackaging=true`, and API run metadata matches the JSON (`workflowRunId`, `head_sha`, `dispatchRef`).
3. That same run is **completed success**; no newer eligible dispatch is `queued` / `in_progress` / etc. (fail-closed while a newer preflight is pending).
4. Same run has **`release-candidate-attestation`**; ZIP size-capped; only `release-candidate-attestation.json` extracted via `unzip -p`. The attestation’s `packaging` map (caller ids `linux-install`, `windows-install` from `needs`) is authoritative for packaging: `preflight-gate` only runs after `verify-preflight.ts` requires those needs to succeed. The REST attempt-jobs API check only requires direct jobs **`source`** and **`preflight-gate`** to be `success`—reusable packaging jobs appear as **`linux-install / install-and-start`** and **`windows-install / package-and-install`**, not bare caller ids (see live `build-linux / …` pattern in `fixtures/github-rest-reusable-workflow-jobs-200.json`, run `42247491102`).

### `workflow_dispatch` ref vs tested SHA

- **`workflow_run.head_sha`** = workflow definition revision at dispatch (e.g. `main` tip).
- **`release-preflight-source.sourceCommit`** = tested SHA after checkout (`inputs.source-ref`).

### Artifact API shape

`GET .../actions/runs/{run_id}/artifacts` returns `artifacts[].workflow_run.id` (nested). There is **no** top-level `workflow_run_id`. Fixtures: `fixtures/github-rest-run-artifacts-200.json`.

### Source-record scan

While building bindings, ineligible runs are skipped. Eligible runs with missing or expired source artifacts, invalid source schemas, or mismatched API metadata remain unresolved. An unresolved run newer than the selected proof blocks release: its source cannot be established, so it cannot safely be treated as unrelated. Older unresolved records do not block a newer verified proof. A valid source record bound to its run and attempt may establish that a completed run tested another source SHA.

Artifact-list API errors, artifact binding failures, download failures, ZIP extraction failures, and invalid JSON **abort verification**. A read failure cannot establish that a run is unrelated to the requested SHA, so it must never fall back to an older successful proof. This conservative check applies to every eligible run in the scan window, including older runs whose source cannot be established.

### Rerun policy

- `upload-artifact@v4` uses **`overwrite: true`** on source and attestation names so workflow reruns on the same attempt can replace fixed names.
- Job checks use **`/actions/runs/{id}/attempts/{attempt}/jobs`** so conclusions match the attested attempt. **Re-run failed jobs only** (no `source` on latest attempt) is **unsupported** and fails closed.

### Residual limits (conservative)

- **Scan window:** newest 40 `workflow_dispatch` preflight runs.
- **Newer pending dispatch:** eligible runs with higher `run_number` still `queued` / `in_progress` block release.
- **Newer dispatch with unresolved source:** missing or expired source artifacts, invalid schemas, and mismatched run/attempt metadata block fallback to an older green proof, even after the newer run completes.
- **Newer failed dispatch with source artifact** for the SHA: latest matching binding fails on non-success conclusion.
- **Branch allowlist:** `main` / `release/**` only.
