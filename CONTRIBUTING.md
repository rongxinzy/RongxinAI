# Contributing to ZhiYuan Agent

Thank you for your interest in contributing to ZhiYuan Agent. Contributions of all sizes are welcome, including bug reports, documentation improvements, tests, UI refinements, and new features.

Please read this guide and [`AGENTS.md`](AGENTS.md) before making a code change. `AGENTS.md` contains the repository's detailed architecture and implementation rules.

## Before You Start

- Search the existing [issues](https://github.com/rongxinzy/RongxinAI/issues) and pull requests before opening a new one.
- Use the bug report or feature request issue template and include enough context for others to reproduce or evaluate the request.
- For a large feature, architectural change, or breaking change, open an issue first so the approach can be discussed before implementation.
- Never include API keys, credentials, private documents, personal data, or other sensitive information in an issue, log, screenshot, or test fixture.

## Development Setup

### Requirements

- Git
- Node.js `>=24 <25`
- Bun `>=1.3`

Windows release builds also require PortableGit. Native dependencies such as `better-sqlite3` may require Python and a supported C/C++ build toolchain when a prebuilt binary is unavailable.

### Install and Run

```bash
git clone https://github.com/rongxinzy/RongxinAI.git
cd RongxinAI
bun install
```

Start the Electron application for normal UI development:

```bash
bun run electron:dev
```

Start the application after preparing the complete bundled runtimes:

```bash
bun run electron:dev:openclaw
```

The complete setup may take longer on its first run because runtime sources and dependencies need to be prepared.

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
- Keep new files below 800 lines when possible and never above 1,000 lines. Add new logic in a separate module instead of extending an existing oversized file.
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
bun test
bun run lint
bun run format:check
bun run compile:electron
```

For a focused test run:

```bash
bun test -- <name>
```

For UI changes, also run the application and manually exercise the affected flow. Check both light and dark themes and both supported languages when relevant. Include screenshots or a short recording in the pull request.

Packaging is platform-specific:

```bash
bun run dist:mac
bun run dist:win
bun run dist:linux
```

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
