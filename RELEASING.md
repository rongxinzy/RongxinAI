# Releasing 知远智能体 (ZhiYuan Agent)

Two workflows, one build, two channels: a `v*` tag runs `release.yml`, which publishes **beta**; `promote.yml` re-signs that same build as **stable**.

Daily PR/push CI runs lint and unit tests only (`bun run test`, alias `test:unit`), without application builds or Electron downloads. Real runtime integration tests and Electron ABI fixtures remain in `test:full` and release preflight.

Local unit runs preserve the existing native addons, reuse separately cached Node ABI output, and restore the original files on completion. Switching back to Electron does not force another rebuild just because tests ran.

Before tagging, run **Release preflight** (`release-preflight.yml`) against the intended source commit. Its default `include-packaging=true` also builds and installs unsigned Windows/Linux packages. All checks use one resolved commit and must pass. Tag releases run the same preflight with `include-packaging=false`: their own signed packages already undergo installation acceptance, so an extra unsigned build would duplicate that work. Quality, runtime, browser, enterprise and memory checks remain mandatory.

## 1. Tag → beta (`release.yml`)

1. Merge fixes/features to `main`.
2. Create and push an annotated tag on `main`: `v<semver>` (no spaces), e.g. `v2026.10.16-build.1`.  
   The tag is the **only** version source; CI sets `APP_BUILD_VERSION` from it.
3. Push triggers **Release (tag)**:
   - Release preflight and Windows/macOS/Linux builds run in parallel; publication waits for preflight and every platform's build/installation acceptance
   - Upload immutable artifacts to R2
   - Publish one complete **beta** update feed (`channels/beta-pointer.json`), preventing platform jobs from overwriting shared metadata or exposing a partial generation
   - Create a GitHub **pre-release** with auto-generated release notes and attached installers

User-facing release text: copy the top section from [`docs/RELEASE_NOTES_TEMPLATE.md`](docs/RELEASE_NOTES_TEMPLATE.md) into the GitHub Release body above the auto-generated PR list. Auto notes are categorized via [`.github/release.yml`](.github/release.yml).

Beta users opt in under **Settings → About → Beta update channel**.

### Edition matrix

`release.yml` builds every edition through `build-inference-editions.yml` (7 legs, kept in sync with `scripts/release/inference-edition-targets.mjs`). The signed beta manifest must contain all of these targets:

| Platform | Editions | Release build |
| --- | --- | --- |
| Windows x64 | `lite`, `cpu`, `cuda` | `dist:win:signed`, `dist:win:signed:cpu`, `dist:win:signed:cuda` (cuda builds on `windows-2022` with CUDA 12.4.1) |
| Linux x64 | `cpu`, `cuda` (deb + AppImage each) | `dist:linux:cpu`; cuda compiles llama-server in Docker (CUDA 12.4 / Ubuntu 22.04), then `dist:linux` |
| macOS arm64, x64 | `cpu` | `dist:mac:<arch>` with `ZHIYUAN_UPDATE_VARIANT=cpu` |

`lite` has no llama.cpp. `cpu` bundles llama.cpp CPU + Vulkan (Metal on macOS). `cuda` bundles an RTX 40 (sm_89) / CUDA 12.4 llama-server, its CUDA libraries, and a CPU fallback. Every leg builds and verifies the pinned Magpie gateway (`magpie:build` + `magpie:verify`) before packaging.

**Full platform rehearsal:** `build-platforms.yml` is manual-only and runs the full seven-leg unsigned matrix. It never starts on PRs or a schedule. Windows CUDA output uses the same exact source/toolchain cache as signed releases; run this rehearsal on `main` before tagging to warm the cache for subsequent tags. A cache hit still verifies every file hash, DLL closure and CPU fallback startup. Changes to the pinned runtime, compiler image or build inputs invalidate the cache. Tag **`release.yml`** remains the authoritative signed build.

Release size policy (krli, 2026-10-19): all editions report installer, component and staged runtime sizes without size ceilings. `scripts/installer-shell/distribution-budget.cjs` and `scripts/ci/measure-llamacpp-bundled.cjs` retain measurements; SHA-256, complete component identity, signatures and runtime/install acceptance remain mandatory. Both NSIS updates and WebView2 installers carry the complete edition component set: seven base components for lite, plus the bundled inference runtime for CPU/CUDA. NSIS cold-install and cache-hit-upgrade acceptance must launch the installed CPU runtime/fallback on a clean PATH. Size optimization and any future ceilings are a separate post-release decision.

Windows compiles application code once, then packages and signs each edition with its own metadata and component routing. Packaging must run the normal hooks: `--prepackaged` would reuse lite metadata and skip the CPU/CUDA component preparation. Each edition is checkpointed with its public signing certificate, final package metadata and candidate payload before the next edition changes the output directory. Three independent acceptance jobs restore those exact bytes, check signatures and runtimes, exercise NSIS cold install/cache upgrade/uninstall and WebView2/native uninstall, then upload the accepted candidates. The shared compression qualification is measured once and verified against each restored archive.

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
- **GitHub**: `contents: write` on release/promote jobs for Releases API.
- **CDN**: `updates.rongxzyai.com` must serve `channel=beta` and `channel=stable` (v1 manifest + v2 electron feeds under `/v2/electron/{beta,stable}/`).

### Magpie gateway signing

The bundled Magpie binary is built locally from the commit pinned in `resources/magpie/upstream.json`; upstream ships no signed Windows or Linux binaries. Before packaging each target, run `bun run magpie:build --target <key> --go <pinned Go SDK>` and then `bun run magpie:verify --target <key>`. electron-builder hooks verify the unmodified compiler output again before packaging and after signing.

- **Windows**: `dist:win:signed` signs `resources/magpie/win32-x64/magpie.exe` with the same Certum certificate through `scripts/runtime-signing/sign-runtime.ps1` (it sits outside electron-builder's own sign walk), then rewrites its manifest with the signed SHA-256. Without a valid `CERTUM_CERT_THUMBPRINT` the binary stays unsigned and must match the build hash.
- **macOS**: `scripts/sign-magpie-macos.cjs` signs both `darwin-*/magpie` helpers with the Developer ID identity and the hardened runtime (it refuses to sign without it), seals their manifests, and the whole .app is notarized. `release.yml` checks the result with `scripts/ci/verify-packaged-magpie-signature.mjs`.
- **Allowlist**: `scripts/ci/magpie-gateway-allowlist.mjs` exempts only the exact pinned, unmodified gateway binary (hash and manifest must match `resources/magpie/upstream.json`) from the decoupling check.
