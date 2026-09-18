# Windows runtime signature gates

Both Windows runtimes must be Authenticode-signed by their publisher before
desktop packaging. SHA-256 download and offline component checks remain in
place; code signatures are an additional independent gate.

Set the public repository variable `RUNTIME_SIGNER_THUMBPRINT` to the expected
40-character SHA-1 certificate thumbprint. This is a certificate identity,
not the file hash or a private credential. Verification does not require
SimplySign, certificate-store installation, or access to a signing key.
Missing configuration fails closed. A certificate rollover requires an
explicit variable update and new signed runtime releases.

The prepack action downloads the pinned sidecar and memory releases and
checks trust, publisher identity, code-signing usage, and timestamps before
packaging. Cold-install and cache-hit-upgrade gates repeat verification
against the actual installed executables, including the sidecar extracted
from its offline component. The builder excludes `engram.exe` from its own
signing pass to preserve the runtime publisher's signature. Application and
installer signing remain unchanged.

## Rollout dependencies

1. Merge the central RongxinAI signing workflow and both runtime workflows.
   Certum credentials remain exclusively in RongxinAI's `release` environment.
   Configure cross-repository artifact read tokens, not additional Certum keys.
2. Build new runtime tags, dispatch central signing, then dispatch verified
   publication in each original runtime repository. Do not mutate old assets.
3. Update `package.json` runtime versions and Windows checksums from those
   releases. Set the public signer variable in both desktop repositories.
4. Run Windows source verification and cold-install/upgrade gates before
   releasing either desktop product.

Existing unsigned pinned releases will be rejected intentionally. Do not
merge the consumer gate change until the pins and public signer are ready.
Policy unit tests mock signature results and do not certify a real release.

See the [central operational guide](https://github.com/rongxinzy/RongxinAI/blob/main/scripts/runtime-signing/README.md)
for protected manual stages, token permissions and artifact expiry handling.

Manual verification:

```powershell
./scripts/ci/verify-windows-runtime-signatures.ps1 -ExpectedThumbprint <public-thumbprint>
./scripts/ci/verify-windows-runtime-signatures.ps1 -ResourcesRoot <installed-resources> -ExpectedThumbprint <public-thumbprint>
```
