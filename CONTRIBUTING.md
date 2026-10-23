# Contributing to ZhiYuan Agent

The shared PR and review process is defined in [DEVOPS.md](DEVOPS.md). Use its concise template; the UI, Electron, security, and release requirements below remain in effect.

Thank you for your interest in contributing to ZhiYuan Agent. Contributions of all sizes are welcome, including bug reports, documentation improvements, tests, UI refinements, and new features.

Please read this guide and [`AGENTS.md`](AGENTS.md) before making a code change. `AGENTS.md` contains the repository's detailed architecture and implementation rules. For a concise map of processes, Pi, llama.cpp modules, IPC conventions, and release flow, see [`docs/architecture/overview.zh-CN.md`](docs/architecture/overview.zh-CN.md).

## Before You Start

- For how-to questions or sharing workflows, use [GitHub Discussions](https://github.com/rongxinzy/RongxinAI/discussions) instead of issues. All participants are expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
- Search the existing [issues](https://github.com/rongxinzy/RongxinAI/issues) and pull requests before opening a new one.
- Use the bug report or feature request issue template and include enough context for others to reproduce or evaluate the request.
- For a large feature, architectural change, or breaking change, open an issue first so the approach can be discussed before implementation.
- Never include API keys, credentials, private documents, personal data, or other sensitive information in an issue, log, screenshot, or test fixture.

## Development Setup

### Requirements

- Git
- Node.js `>=24 <25`
- Bun `>=1.4 <1.5` (matches `package.json` `packageManager`)
- Electron **44.x** (desktop shell; see `devDependencies.electron` in `package.json`)
- Pi agent stack **`@earendil-works/pi-*` 1.4.0** (execution kernel consumed by `piRuntimeAdapter.ts`)
- Go: only for packaging. The exact SDK version pinned in `resources/magpie/upstream.json` (currently Go 1.26.8) is required by `bun run magpie:build`

Windows release builds also require PortableGit. Native dependencies such as `better-sqlite3` may require Python and a supported C/C++ build toolchain when a prebuilt binary is unavailable.

### Install and Run

```bash
git clone https://github.com/rongxinzy/RongxinAI.git ZhiYuanAgent
cd ZhiYuanAgent
bun install
```

For day-to-day renderer UI iteration, start the browser preview and use its Vite hot reload:

```bash
bun run web:preview
```

The preview uses typed fixture data in place of the Electron preload bridge. Inspect layouts, interactions, themes, responsive states, and console output in the browser. Run `bun run web:preview:check` for a light/dark walkthrough (install Playwright Chromium first with `bunx playwright install chromium`); release preflight runs the same Playwright suite. Regenerate committed documentation screenshots under `docs/theme-previews/` with `bun run preview:doc-screenshots`. See [README.md](README.md#browser-preview-mode) for scope.

Start Electron when verifying real IPC, native-window or system behavior, and affected end-to-end flows:

```bash
bun run electron:dev
```

Use Bun for dependency installation and commit changes to `bun.lock` when dependencies change. Do not create or commit an npm lockfile.

## Project Layout

| Path                  | Purpose                                                    |
| --------------------- | ---------------------------------------------------------- |
| `src/main/`           | Electron main process, services, storage, and IPC handlers |
| `src/main/preload.ts` | Secure bridge between the main and renderer processes      |
| `src/renderer/`       | React application and renderer-side services               |
| `src/shared/`         | Shared types, utilities, and reusable UI components        |
| `src/scheduledTask/`  | Scheduled-task domain logic and constants                  |
| `SKILLs/`             | Skills bundled with the application runtime                |
| `MCPs/`               | Bundled MCP integrations                                   |
| `scripts/`            | Development, runtime, and packaging scripts                |
| `docs/architecture/`  | Current architecture notes (streaming doc pending PR #1119) |

ZhiYuan Agent uses Electron process isolation. Renderer code must not access Node.js or Electron APIs directly; use the typed preload and IPC boundary.

## Making a Change

Create a focused branch from the latest `main`:

```bash
git switch main
git pull --ff-only
git switch -c fix/short-description
```

Use a descriptive prefix such as `feat/`, `fix/`, `docs/`, `refactor/`, or `test/`. Keep each pull request focused on one problem, and avoid unrelated formatting or refactoring.

When changing behavior:

- Add or update co-located Vitest tests where practical.
- Preserve process isolation and update all affected IPC types, constants, preload methods, handlers, and callers together.
- Add user-visible text to both the Chinese and English i18n dictionaries. Do not hardcode UI copy.
- Use the public product name **ZhiYuan Agent** in English-facing product copy.
- Update relevant documentation when setup, configuration, or user behavior changes.

## Code Style

- Write TypeScript and use functional React components with Hooks.
- Use 2-space indentation, single quotes, and semicolons.
- Use `PascalCase` for components and `camelCase` for functions and variables.
- Prefer Tailwind CSS v4 utilities over new standalone CSS.
- Reuse components in `src/shared/components/ui/` and `src/shared/components/ai-elements/` before creating new ones.
- Use `lucide-react` for interface icons instead of handwritten SVG icon components.
- Use `cn()` from `@shared/lib/utils` to merge class names.
- Keep new files below 800 lines when possible and never above 1,000 lines. CI enforces the hard cap via `scripts/ci/check-source-line-limit.mjs`; legacy oversize files may appear in `scripts/ci/source-line-baseline.json`, and those caps may only shrink over time. Add new logic in a separate module instead of extending an existing oversized file.
- Centralize discriminants, status values, modes, and IPC channel names in an `as const` object. Do not repeat bare string literals across the codebase. See `src/scheduledTask/constants.ts` for the canonical pattern.

Main-process logs must use the standard `console` API, begin with a module tag such as `[Scheduler]`, and read as concise English sentences. Avoid info-level logging in polling loops, and pass the caught error object as the final argument of error logs.

Run the formatter instead of manually reformatting unrelated code:

```bash
bun run format
```

## Tests and Checks

Unit tests use Vitest and must be co-located with their source files using the `.test.ts` extension.

Run the relevant checks before opening a pull request:

```bash
bun run build
bun run test
bun run lint
bun run knip
bun run format:check
bun run compile:electron
```

Renderer toast notifications must go through `showAppToast` / `showAppError` in `src/renderer/services/toastNotification.ts` (re-exported from `appToast.ts`). Do not dispatch `CustomEvent('app:showToast')` directly; `bun run lint` runs an AST check for violations.

For a focused test run:

```bash
bun test -- <name>
```

For UI changes, manually exercise the affected flow in browser preview first. Check both light and dark themes, relevant states and viewport sizes, and both supported languages when relevant. Run `bun run web:preview:check` and inspect its screenshots. Use Electron for affected real IPC, native, and end-to-end behavior. Include screenshots or a short recording in the pull request, and identify which checks used browser fixtures versus Electron.

CI also enforces these gates on every pull request:

- `bun run knip` fails on unused files, exports, and dependencies. Delete dead code instead of adding ignores.
- `node scripts/ci/check-source-line-limit.mjs` fails on hand-written source files over 1000 lines. The baseline in `scripts/ci/source-line-baseline.json` only ratchets down: CI rejects new entries, raised caps, and a raised limit. The baseline is currently empty, so split a file before it reaches the limit.
- `bun run check:python-dead-code`, `bun run format:check`, `bun run lint`, and `bun run check:openclaw-decoupling`.

## Packaging

Packaging is platform-specific. Every installer bundles a pinned model gateway that is built from source before packaging. The build needs the exact Go SDK pinned in [`resources/magpie/upstream.json`](resources/magpie/upstream.json) (currently Go 1.26.8), plus Git and tar; the builder rejects any other Go version and never downloads a toolchain. Packaging fails with an explicit error when the gateway binary for the target is missing or does not match its manifest. `--target` accepts `win32-x64`, `darwin-arm64`, `linux-x64` and other platform keys, or `all`; see [`resources/magpie/README.md`](resources/magpie/README.md).

Build and verify the gateway for the target, then package:

```bash
bun run magpie:build --target win32-x64 --go /path/to/go
bun run magpie:verify --target win32-x64
bun run dist:win               # lite edition (= dist:win:offline / dist:win:lite), unsigned
bun run dist:win:cpu           # cpu edition: bundled llama.cpp CPU + Vulkan
bun run dist:win:cuda          # cuda edition: RTX 40 / CUDA 12.4 llama.cpp + CPU fallback
bun run dist:win:signed        # Certum-signed lite; :cpu / :cuda suffixes for the other editions
bun run dist:linux:cpu         # or dist:linux:cuda; Linux has no lite edition
bun run dist:mac:arm64         # or dist:mac:x64; macOS ships the cpu edition only
```

See [README.md](README.md#editions) for the edition matrix.

You normally do not need to create an installer for a small change. If packaging behavior changed, test it on the target operating system and describe the result in the pull request.

## Commit Messages

All commit messages must be written in English and follow [Conventional Commits](https://www.conventionalcommits.org/):

```text
type(scope): short imperative summary
```

Supported types are:

`feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `perf`, `style`, `ci`, `build`, and `revert`.

Examples:

```text
feat(cowork): add streaming progress indicator
fix(sqlite): prevent duplicate session insert on retry
docs: clarify Windows development setup
```

For a breaking change, add `!` after the type or scope and include a `BREAKING CHANGE:` footer.

## Pull Requests

Complete the pull request template and include:

- A concise explanation of the problem and the solution.
- A linked issue when applicable.
- The checks and manual flows you tested.
- Screenshots or recordings for visible UI changes.
- Any Electron-specific impact involving IPC, storage, native modules, window behavior, or packaging.
- Migration notes and compatibility impact for breaking changes.

Before submitting, make sure:

- The change is focused and contains no unrelated files.
- New behavior has appropriate tests or a clear explanation of why tests are not practical.
- User-facing text is translated into both Chinese and English.
- Logs, screenshots, and fixtures contain no sensitive information.
- The build, tests, lint, formatting check, and relevant manual verification pass.

Maintainers may ask for changes to keep the implementation consistent with the architecture or to reduce the scope of a pull request. Review feedback is part of the contribution process; resolve conversations only after the requested change or clarification has been provided.

## License

By contributing to this repository, you agree that your contribution will be made available under the repository's [GNU Affero General Public License v3.0](LICENSE).
