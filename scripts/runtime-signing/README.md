# Central Windows runtime signing

Certum SimplySign credentials remain exclusively in the RongxinAI protected
`release` environment. The runtime repositories build unsigned binaries,
request no cloud credentials, and publish final signed releases in their own
repositories. Desktop builds only verify the signatures.

## Configuration

RongxinAI reuses its existing `CERTUM_USER_ID`, `CERTUM_OTP_URI` (full TOTP URI),
and `CERTUM_CERT_THUMBPRINT` environment secrets and its existing Certum action.
Do not copy them to runtime repositories.

Configure the repository secret `RUNTIME_ARTIFACT_READ_TOKEN` in each
participating repository (the central prepare job has no release environment):

- RongxinAI needs Actions/read and Contents/read for `rongxinzy/pi-connect`
  and `z189yis/engram-cjk`.
- Each runtime needs Actions/read and Contents/read for RongxinAI, plus
  Contents/read for its own source provenance.
- No cross-repository write permission is required. The runtime's own
  `GITHUB_TOKEN` publishes its release.

Use appropriately scoped GitHub App tokens or personal access tokens. A
fine-grained PAT is limited to one resource owner; these repositories span
two owners, so one multi-owner fine-grained PAT is not sufficient. Provision
an appropriate credential and ensure it can read every repository required
by that workflow. Do not grant signing-key access with this token.

Set the public `RUNTIME_SIGNER_THUMBPRINT` variable in both runtimes and both
desktop repositories to the certificate's 40-character SHA-1 thumbprint.
Protect each runtime's `release` environment with main-only deployment rules
and required reviewers as appropriate. RongxinAI retains its existing
protected signing environment.

## Protected publication sequence

1. Merge the build/publication changes to each runtime main and the central
   workflow to RongxinAI main. Push a new immutable runtime tag whose commit
   belongs to main. The tagged workflow tests and builds Actions artifacts;
   it does not create a release.
2. From RongxinAI main, dispatch `runtime-central-signing.yml` with
   `sidecar_run_id`, `engram_run_id`, or both. Supply successful tagged build
   run IDs. Approve the signing environment when requested.
3. From each runtime main, dispatch its release workflow with the successful
   central `signing_run_id`. Approve its publication environment. The workflow
   verifies repository/workflow/event, main ancestry, unchanged tag identity,
   manifest metadata/hashes, expected publisher and actual Authenticode trust,
   code-signing usage and timestamp before publication.

This is a three-stage manual protected sequence, not automatic cross-repo
dispatch. Signed files travel through Actions artifacts; final release assets
remain in pi-connect and engram-cjk, not RongxinAI releases.

Source and signed artifacts expire after 14 days. If expired, rebuild the
same unchanged unpublished tag, sign the new successful run, and publish
using that central run. A failed publishing run can be retried only when no
release was created; inspect any partially created release before proceeding.
Never replace assets of an existing published version: use a new tag.

Pi substitutes the returned Windows EXE before generating checksums. Engram
rebuilds with pinned Go/GoReleaser and reproducible flags, requires the rebuilt
unsigned hashes to match the original build, substitutes the signed bytes
before archiving, then checks ZIP contents and checksums before explicitly
publishing all six archives, checksums and SBOMs. A mismatch fails closed.

## Desktop rollout

Publish the new signed releases first, then update desktop runtime pins and
SHA-256 values together. Existing unsigned pins must not be silently accepted.
Keep consumer PRs draft until signed versions and the public signer are ready.
Application/installer signing is unchanged; runtime EXEs are not re-signed by
the desktop builder. Mock policy tests are not proof of real cloud signing:
the first protected release and desktop cold-install/upgrade gates provide
that validation.
