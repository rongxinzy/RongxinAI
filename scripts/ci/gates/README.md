# CI gate scripts

## Daily `ci-gate` (`ci.yml`)

`verify.ts` aggregates parallel baseline jobs (`lint`, `typecheck`, `test` shards). Release verification does **not** reuse commit check-run lists: it loads the **latest** `ci.yml` workflow run for the source SHA (including in-progress reruns) and requires that run—and its `ci-gate` job—to be successful.

## Release candidate proof (`release.yml`)

`verify-release-candidate-readiness.mjs` (via `verify-release-candidate-api.ts`) requires:

1. Latest completed-success **CI** run on the tagged `SOURCE_COMMIT`, with a successful `ci-gate` job (an older green run cannot mask a newer failure).
2. The **latest** eligible `workflow_dispatch` **Release preflight** run whose `source` job output `commit` (GitHub Actions **job** API, not dispatch inputs) equals `SOURCE_COMMIT`, on `main` or `release/**`, with run `path` = `release-preflight.yml`, `conclusion=success`, and not in progress. A newer failed or in-progress preflight for the same resolved source blocks release even when an older attestation exists.
3. A **`release-candidate-attestation`** artifact **on that run only** (no repository-wide artifact scan). ZIP download is size-capped; only `release-candidate-attestation.json` is extracted (`unzip -p`). JSON `workflowRunId` / `workflowRunAttempt` / `workflowHeadSha` / `dispatchRef` must match the GitHub run and artifact metadata; `preflight-gate`, `linux-install`, and `windows-install` job conclusions must be `success`.

### `workflow_dispatch` ref vs `source-ref`

On **Release preflight** manual dispatch:

- **`github.ref` / `workflowHeadSha`** identify the workflow definition revision that executed (the branch selected in the Actions UI, usually `main`).
- **`inputs.source-ref`** is checked out by the `source` job; `source.outputs.commit` is the **tested** SHA written into the attestation.

Release gates trust **`sourceCommit` in the attestation**, not `workflow_run.head_sha` (dispatch ref SHA). A dispatch from `main` while testing an older `source-ref` is valid when the attestation `sourceCommit` matches the tag. A successful preflight with `include-packaging=false` or skipped install jobs does **not** publish an attestation and cannot satisfy the release gate.

Attestations are uploaded only from `publish-release-candidate-attestation.mjs` after `verify-preflight.ts` passes with packaging required.

### Residual limits

- **Scan window:** only the newest `MAX_PREFLIGHT_DISPATCH_RUNS_SCANNED` (40) `workflow_dispatch` preflight runs are considered; older successful preflights for the same SHA are invisible to the gate.
- **Dispatch inputs:** `workflow_dispatch` `source-ref` / `include-packaging` inputs are not exposed on the workflow run REST object; association uses the `source` job’s output `commit`. If that job did not complete or export output, the run cannot prove the candidate SHA.
- **Branch allowlist:** dispatches from branches other than `main` / `release/**` are ignored; attestation JSON alone cannot override API run metadata.
