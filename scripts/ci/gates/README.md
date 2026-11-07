# CI gate scripts

## Daily `ci-gate` (`ci.yml`)

`verify.ts` aggregates parallel baseline jobs (`lint`, `typecheck`, `test` shards). Release verification does **not** reuse commit check-run lists: it loads the **latest** `ci.yml` workflow run for the source SHA (including in-progress reruns) and requires that run—and its `ci-gate` job—to be successful.

## Release candidate proof (`release.yml`)

`verify-release-candidate-readiness.mjs` requires:

1. Latest completed-success **CI** run on the tagged `SOURCE_COMMIT`, with a successful `ci-gate` job (an older green run cannot mask a newer failure).
2. A **`release-candidate-attestation`** Actions artifact produced by **Release preflight** after `preflight-gate` succeeds with **`include-packaging=true`** (Linux and Windows install jobs must be `success`, not skipped).

### `workflow_dispatch` ref vs `source-ref`

On **Release preflight** manual dispatch:

- **`github.ref` / `workflowHeadSha`** identify the workflow definition revision that executed (the branch selected in the Actions UI, usually `main`).
- **`inputs.source-ref`** is checked out by the `source` job; `source.outputs.commit` is the **tested** SHA written into the attestation.

Release gates trust **`sourceCommit` in the attestation**, not `workflow_run.head_sha` (dispatch ref SHA). A dispatch from `main` while testing an older `source-ref` is valid when the attestation `sourceCommit` matches the tag. A successful preflight with `include-packaging=false` or skipped install jobs does **not** publish an attestation and cannot satisfy the release gate.

Attestations are uploaded only from `publish-release-candidate-attestation.mjs` after `verify-preflight.ts` passes with packaging required.
