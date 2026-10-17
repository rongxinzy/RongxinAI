# Releasing 知远智能体 (ZhiYuan Agent)

Two workflows, one build, two channels.

## 1. Tag → beta (`release.yml`)

1. Merge fixes/features to `main`.
2. Create and push an annotated tag on `main`: `v<semver>` (no spaces), e.g. `v2026.10.16-build.1`.  
   The tag is the **only** version source; CI sets `APP_BUILD_VERSION` from it.
3. Push triggers **Release (tag)**:
   - Quality gates + memory regression + signed Windows/macOS/Linux builds and installer smokes
   - Upload immutable artifacts to R2
   - Publish the **beta** update feed (`channels/beta-pointer.json`)
   - Create a GitHub **pre-release** with auto-generated release notes and attached installers

Beta users opt in under **Settings → About → Beta update channel**.

## 2. Promote → stable (`promote.yml`)

Manual **workflow_dispatch** with one input:

| Input | Meaning |
| --- | --- |
| `version` | SemVer **without** `v`, must match a completed tag release already on beta |

This job **does not rebuild**. It re-signs the existing beta generation as **stable**, moves the stable CDN pointer, runs post-publish smoke tests, and marks the GitHub release **latest** (non-prerelease).

### Rollback

Re-run **Promote** with the **previous** stable version string. When the requested version is older than the current stable pointer, CI sets `ALLOW_STABLE_ROLLBACK=true` and replaces the stable feed with that generation’s artifacts (already in R2).

## Hotfix

1. `fix/*` → PR → `main`
2. New patch tag (e.g. `v2026.10.16-build.2`) → wait for `release.yml`
3. **Promote** with that version

## Enterprise

Community OTA is unchanged. Enterprise Windows packages still use **Build Zhiyuan Enterprise Windows package (manual)** (`enterprise-windows.yml`).

## Secrets & environments

- **`release` environment**: R2, update manifest signing, Certum/Apple credentials (same as before).

### Magpie gateway signing

The bundled Magpie binary is built locally from the commit pinned in `resources/magpie/upstream.json`; upstream ships no signed Windows or Linux binaries. Before packaging each target, run `bun run magpie:build --target <key> --go <pinned Go SDK>` and then `bun run magpie:verify --target <key>`. electron-builder hooks verify the unmodified compiler output again before packaging and after signing.

- **Windows**: `dist:win:signed` signs `resources/magpie/win32-x64/magpie.exe` with the same Certum certificate through `scripts/runtime-signing/sign-runtime.ps1` (it sits outside electron-builder's own sign walk), then rewrites its manifest with the signed SHA-256. Without a valid `CERTUM_CERT_THUMBPRINT` the binary stays unsigned and must match the build hash.
- **macOS**: `scripts/sign-magpie-macos.cjs` signs both `darwin-*/magpie` helpers with the Developer ID identity and the hardened runtime (it refuses to sign without it), seals their manifests, and the whole .app is notarized. `release.yml` checks the result with `scripts/ci/verify-packaged-magpie-signature.mjs`.
- **Allowlist**: `scripts/ci/magpie-gateway-allowlist.mjs` exempts only the exact pinned, unmodified gateway binary (hash and manifest must match `resources/magpie/upstream.json`) from the decoupling check.
- **GitHub**: `contents: write` on release/promote jobs for Releases API.
- **CDN**: `updates.rongxzyai.com` must serve `channel=beta` and `channel=stable` (v1 manifest + v2 electron feeds under `/v2/electron/{beta,stable}/`).
