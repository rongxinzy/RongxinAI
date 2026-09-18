# Windows runtime signing policy

Windows runtime executables are signed centrally with the existing Certum
credentials in `rongxinzy/RongxinAI`, then published in their original runtime
repositories. Desktop builds do not re-sign these executables.

Runtime publication and desktop download, packaging, cold-install and upgrade
checks do not perform Authenticode verification. No public
`RUNTIME_SIGNER_THUMBPRINT` variable is required. This intentionally removes
publisher identity, trust-chain, EKU and timestamp checks; SHA-256 checks are
integrity checks, not a substitute for signature verification.

Frozen runtime release pins, download SHA-256 checks, offline component and
sentinel hashes, installed-file existence, and clean-PATH execution smoke tests
remain in place. The builder still excludes `engram.exe` from its own signing
pass. Application and installer signing and verification are unchanged.

## Rollout

1. Merge the central and runtime workflow updates. Configure cross-repository
   `RUNTIME_ARTIFACT_READ_TOKEN` secrets and main-only runtime `release` environments.
   Do not copy Certum credentials to the runtime or desktop repositories.
2. Build a new immutable runtime tag, dispatch central signing from main, then
   dispatch publication in the original runtime repository. Source provenance,
   returned hashes, and archive integrity remain mandatory.
3. Update `package.json` runtime pins, source revision and SHA-256 values from
   the published assets together. Never replace an existing release's assets.
4. Run desktop CI and Windows package/install/upgrade/uninstall smoke checks.

The central signing command must succeed; there is no unsigned-release
fallback on signing command failure. No post-sign runtime signature check is
performed. Policy tests are not proof of real cloud signing.

See the [central operational guide](https://github.com/rongxinzy/RongxinAI/blob/main/scripts/runtime-signing/README.md)
for the manual sequence, token permissions and artifact expiry handling.
