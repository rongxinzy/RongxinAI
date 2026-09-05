# AGENTS.md

This file provides guidance to coding agents when working with code in this repository.

## Build and Development Commands

```bash
# Development - starts Vite dev server (port 5175) + Electron app with hot reload
npm run electron:dev

# Build production bundle (TypeScript + Vite)
npm run build

# Lint with oxlint (config: .oxlintrc.json)
npm run lint

# Format with oxfmt (config: .oxfmtrc.json)
npm run format

# Run unit tests (Vitest)
npm test

# Compile Electron main process only
npm run compile:electron

# Package for distribution (platform-specific)
npm run dist:mac        # macOS (.dmg)
npm run dist:win        # Windows (.exe)
npm run dist:linux      # Linux (.AppImage)

```

**Requirements**: Node.js >=24 <25, Bun >=1.3 (package manager; `bun install` instead of `npm install`, lockfile is `bun.lock`). Windows builds require PortableGit (see README.md for setup).

## 设计宪法：DESIGN.md

`DESIGN.md` 是本仓库一切 UI 工作的**最高约束（宪法级）**，是色彩、字体、字号、圆角、阴影、间距、边框、透明度、动效、交互手感、组件范式的唯一事实来源。本文件中任何 UI 条目与 DESIGN.md 冲突时，以 DESIGN.md 为准。

1. **先读再写。** 新增或修改任何 UI 代码之前，必须先读 DESIGN.md 的相关章节。凭记忆、凭组件库默认值、凭仓库现有代码写 UI，视同未读。
2. **冲突时代码让路。** 既有代码、组件库默认样式、第三方示例与 DESIGN.md 冲突时，以 DESIGN.md 为准并修正代码。禁止引用旧先例为新违规辩护——"原来就是这么写的"不是理由。
3. **评审可仅凭违反 DESIGN.md 打回。** 不需要证明存在 bug 或功能缺陷；违反标准本身即是缺陷。
4. **标准只在一个地方改。** 需要新颜色、新圆角、新动效、新控件范式时，先改 DESIGN.md 和 token 契约，再写代码。禁止在调用点用任意值（`rounded-[7px]`、`shadow-[...]`、`text-[13px]`）绕过刻度。
5. **用户明确要求偏离时**，先指出与 DESIGN.md 的冲突并确认，然后在 PR 描述中标注偏离点。

## Architecture Overview

知远智能体 is an Electron + React desktop application for local-first AI Agent workflows. Its core areas are:

1. **Cowork Mode** - AI-assisted task sessions powered exclusively by the in-process Pi runtime
2. **llama.cpp Local Inference** - local model service management, model launch options, and Pi model integration
3. **Skills and MCP** - built-in skills, remote skill marketplace, and MCP server configuration
4. **Artifacts System** - rich preview of code outputs (HTML, SVG, React, Mermaid)

Uses strict process isolation with IPC communication.

Public-facing product documentation and user-visible UI copy must use the 知远智能体 (ZhiYuan Agent) name. All pre-rebrand product names are retired and must not be reintroduced. Pi, cc-connect, and llama.cpp are internal implementation details: never expose them in branding or user-facing copy; describe the agent runtime and local inference as self-developed (全栈自研). Legacy identifiers and the retired runtime are handled under a scorched-earth policy: no data migration, compatibility shims, reads, startup, packaging, or fallback. Old data and directories are abandoned in place and are not actively deleted.

### Authentication Flow

浏览器登录后通过 deep-link 一次性 `authCode` 换取 2 小时 access token 与 30 天 refresh token；令牌保存在 SQLite `auth_tokens`。`fetchWithAuth()` 附带 Bearer token，401 或 access token 剩余不足 5 分钟时刷新并轮换 refresh token；30 天未使用则清除。实现见 `src/renderer/services/api.ts`、`src/main/main.ts`、`src/main/sqliteStore.ts`。

### Process Model

**Main Process** (`src/main/main.ts`):

- Window lifecycle management
- SQLite storage via `better-sqlite3` (`src/main/sqliteStore.ts`)
- Agent runtime (`src/main/libs/agentEngine/`) - `piRuntimeAdapter.ts` is the sole execution kernel for Work, Chat, Channel, and Cron runs
- Channel/Cron transport (`src/main/libs/ccConnect*`, `src/main/im/`) - cc-connect sidecars carry inbound/outbound events and cron triggers only; they never execute the agent or own task state
- llama.cpp lifecycle and local inference management (`src/main/libs/llamacppManager.ts`, `src/shared/llamacpp/`)
- Skill management (`src/main/skillManager.ts`)
- MCP server configuration and marketplace integration
- IM/email gateways (`src/main/im/`) - public-facing channels are WeChat, WeCom, DingTalk, Feishu/Lark, QQ, and Email. Legacy/global connector code may exist; do not re-expose it in UI or docs unless explicitly requested.
- IPC handlers for store, cowork, and API operations (40+ channels)
- Security: context isolation enabled, node integration disabled, sandbox enabled

**Preload Script** (`src/main/preload.ts`):

- Exposes `window.electron` API via `contextBridge`
- Includes `cowork` namespace for session management and streaming events

**Renderer Process** (React in `src/renderer/`):

- All UI and business logic
- Communicates with main process exclusively through IPC

### Main Process / Worker Boundary

The Electron main process owns lifecycle, IPC, security decisions, persistent state, and ordering. It must remain responsive: do not add synchronous recursive filesystem traversal, whole-file reads/hashes, large JSON/Markdown parsing, regex-heavy scanning, compression, or other CPU-bound work to request, IPC, or agent-stream paths.

Use a Node `worker_threads` worker for a task only when its input/output is serializable and it can be isolated from mutable application state. Workers may scan files, parse/index content, hash immutable files, and perform bounded transforms. Use a bounded reusable pool (maximum two background workers), cancellation, input/queue limits, structured error results, and transfer `ArrayBuffer` payloads when practical. Main process code validates paths and results, owns writes and user-visible state changes, and records queue wait/run time for new worker jobs.

Never move these across the boundary without an approved dedicated architecture change: Electron APIs (`BrowserWindow`, `ipcMain`, dialogs, `safeStorage`), SQLite connections/transactions, agent session lifecycle, tool approval, stream ordering, secrets, or renderer/DOM work. A Worker Thread does not make SQLite concurrency safe.

**Touch-to-refactor rule.** Any PR that changes a component containing blocking file scan/hash/parse/transform work must extract that work to a Worker Thread in the same PR; it is not optional cleanup. This applies in particular to Skill security scanning, artifact collection and hashing, backup snapshot hashing, model catalog scanning, and large artifact parsing. The PR must include a worker-boundary test plus before/after timing or event-loop-lag evidence. If the touched component owns a prohibited stateful operation, extract every separable pure blocking portion and document the retained ownership boundary in the PR; do not add further synchronous work there.

### Data Flow

1. **Initialization**: `src/renderer/App.tsx` → `coworkService.init()` → loads config/sessions via IPC → sets up stream listeners
2. **Cowork Session**: User sends prompt → `coworkService.startSession()` → IPC to main → `PiRuntimeAdapter` → streaming events back to renderer via IPC → Redux updates
3. **Tool Permissions**: Agent requests tool use → `PiRuntimeAdapter` emits `permissionRequest` → UI shows `CoworkPermissionModal` → user approves/denies → result sent back to engine
4. **Persistence**: Cowork sessions stored in SQLite (`cowork_sessions`, `cowork_messages` tables)
5. **Local Inference**: Renderer invokes llama.cpp IPC → main process manages `llama-server`, model install/list/load state, and service/model launch parameters

### Cowork System

The Cowork feature provides AI-assisted coding sessions:

**Execution Modes** (`CoworkExecutionMode`):

- `auto` - Automatically choose based on context
- `local` - Run tools directly on the local machine

**Agent Engine**: Pi is the only execution kernel. `cowork:stream:*` carries Work/Chat events, while Channel/Cron runs are exposed as their own read-only activity projection. cc-connect only transports Channel/Cron inputs and deliveries.

**Managed Python runtimes**: two layers, both synced to `userData/runtimes/` on first run.

- `resources/python-win|mac|linux` — bare portable CPython (uv-managed). On the agent shell PATH as the base interpreter; `UV_PYTHON` binds uv to it.
- `resources/skill-python/layers/shared` — a single relocatable uv venv built on the base runtime, carrying the merged `requirements.txt` of every bundled Skill (pandas, numpy, openpyxl, ...). Its interpreter is prepended to the agent shell PATH (`prependSkillSharedPythonToEnv` in `src/main/libs/coworkUtil.ts`), so ad-hoc `python` scripts can `import pandas` directly. Skill script execution (`run_skill_script`) resolves it via `findSkillPythonExecutable`, which additionally enforces a per-Skill `requirementsSha256` manifest gate.

SYSTEM_PROMPT.md declares this environment to the model (运行环境与工具链 section); keep that section in sync when the runtime layout changes.

**Memory System**: File-based persistent memory stored in the application-owned agent workspace:

- `MEMORY.md` - Durable facts, preferences, and decisions; loaded automatically at every session start.
- `memory/YYYY-MM-DD.md` - Daily notes for recent context.
- `USER.md` / `SOUL.md` - User profile and agent personality files read at session startup.
- Writes happen via the agent's `write` tool when the user issues an explicit "remember" instruction or the agent self-records important findings. No background extraction or confidence scoring.
- GUI in Settings panel allows manual add/edit/delete of `MEMORY.md` entries.

**Stream Events** (IPC from main to renderer):

- `message` - New message added to session
- `messageUpdate` - Streaming content update for existing message
- `permissionRequest` - Tool needs user approval
- `complete` - Session execution finished
- `error` - Session encountered an error

**Key IPC Channels**:

- `cowork:startSession`, `cowork:continueSession`, `cowork:stopSession`
- `cowork:getSession`, `cowork:listSessions`, `cowork:deleteSession`
- `cowork:respondToPermission`, `cowork:getConfig`, `cowork:setConfig`

### Key Patterns

- **Streaming responses**: provider chat APIs can use SSE with `onProgress` callback for real-time message updates
- **Cowork streaming**: Uses IPC event listeners (`onStreamMessage`, `onStreamMessageUpdate`, etc.) for bidirectional communication
- **Markdown rendering**: `react-markdown` with `remark-gfm`, `remark-math`, `rehype-katex` for GitHub markdown and LaTeX
- **Theme system**: Class-based Tailwind dark mode, applies `dark` class to `<html>` element
- **i18n**: Simple key-value translation in `services/i18n.ts`, supports Chinese (default) and English. Language auto-detected from system locale on first run.
- **Path alias**: `@` maps to `src/renderer/` in Vite config for imports.
- **Skills**: Custom skill definitions in `SKILLs/` directory, configured via `skills.config.json`
- **llama.cpp parameters**: service-level options control the managed `llama-server` process; model-level options are passed when loading or running a model.

### Artifacts System

Artifacts support HTML, SVG, Mermaid, React/JSX, and code through explicit `artifact:*` fences or heuristics. HTML and React run in isolated iframes; SVG is sanitized with DOMPurify; Mermaid uses strict security. Preserve these boundaries when changing renderers.

### Configuration

- App config stored in SQLite `kv` table
- Cowork config stored in `cowork_config` table (workingDirectory, systemPrompt, executionMode, **agentEngine**)
- Cowork sessions and messages stored in `cowork_sessions` and `cowork_messages` tables
- Task, Run, Delivery, ChannelAccount, and ChannelSession records are canonical in ZhiYuan SQLite
- Database file: `zhiyuan.sqlite` in the user data directory. Pre-rename database files are not migrated or read — old data is abandoned in place (scorched earth).

### TypeScript Configuration

- `tsconfig.json`: React/renderer code (ES2020, ESNext modules)
- `electron-tsconfig.json`: Electron main process (CommonJS output to `dist-electron/`)

### Key Dependencies

- Pi SDK packages - sole in-process agent execution kernel
- cc-connect sidecar - Channel/Cron transport only
- `better-sqlite3` - SQLite database for persistence
- `react-markdown`, `remark-gfm`, `rehype-katex` - Markdown rendering with math support
- `mermaid` - Diagram rendering
- `dompurify` - SVG/HTML sanitization

## UI Component Libraries

项目使用两套 UI 组件库。**所有 UI 代码必须优先使用这些组件，禁止自造轮子。**

**设计标准见 `DESIGN.md`——它是宪法级约束（见本文顶部「设计宪法」）。** 主题只保留浅色 / 深色 / 跟随系统。

### shadcn/ui（基础组件）

位于 `src/shared/components/ui/`，基于 [shadcn/ui](https://ui.shadcn.com/) 和 lucide。优先使用现有按钮、输入、选择、弹层、菜单、表格、反馈和布局组件；页面 tab 仅用 `page-tabs`，分段/筛选仅用 `fluid-tabs`，删除确认仅用 `destructive-confirm-dialog`。

### ai-elements（对话组件）

位于 `src/shared/components/ai-elements/`；聊天使用 `conversation`、`message`、`prompt-input`，按需使用 code、reasoning、tool、attachment、source、suggestion、loading 与 terminal 组件。

### 规则

1. **先查再写。** 写任何 UI 前，先检查上面两个目录是否有现成组件可用。
2. **禁止自造基础组件。** 不要自己写 button / dialog / select / tooltip / tabs / popover 等，shadcn/ui 已有。
3. **图标用 lucide-react。** 禁止手写 SVG 图标组件（项目已删除 30+ 个自定义 icon，全部迁移到 lucide）。
4. **对话 UI 用 ai-elements。** 聊天、消息、推理展示等场景必须用 ai-elements，不要自己拼。
5. **页面顶栏用 PageHeader。** 侧边栏切换的功能页必须使用 `src/renderer/components/PageHeader.tsx`（统一 h-12 / px-4 / draggable / border-b / 折叠按钮组 / mac 留白 / WindowTitleBar），禁止手写页面顶栏。页面标题只在 PageHeader 出现一次，内容区 hero 不重复标题。
6. **三个唯一实现。** 页面级标签页用 `PageTabs`（放 PageHeader 的 tabs 槽位）、分段/筛选控件用 `FluidTabs`、删除确认用 `DestructiveConfirmDialog`。禁止手搓 tab、自造分段条、自写确认框——细则与选中态语言见 DESIGN.md 对应章节。
7. **Button 覆写守纪律。** className 只许布局类（`w-full`、`justify-start`、`gap-*`）；颜色、圆角、阴影、字重、字号、高度一律走 variant/size 枚举。行级可点区域不得用裸 `div onClick`（完整范式见 DESIGN.md「Button 使用纪律」）。

Use Tailwind `className` for component composition and `cn()` from `@shared/lib/utils` for class merging; do not add standalone CSS.

## Coding Style & Naming Conventions

- Use TypeScript, functional React components, and Hooks; keep logic in `src/renderer/services/` when it is not UI-specific.
- Match existing formatting: 2-space indentation, single quotes, and semicolons.
- Naming: `PascalCase` for components (e.g., `Chat.tsx`), `camelCase` for functions/vars, and `*Slice.ts` for Redux slices.
- Tailwind CSS v4 is the primary styling approach; prefer utility classes over bespoke CSS. Configuration is CSS-first via `@theme` in `src/renderer/index.css` (no `tailwind.config.js`).

### File Length Limit

- **单文件行数上限：** 单个文件最好不要超过 **800 行**，最多不能超过 **1000 行**。
- **仅适用于新增文件：** 创建新文件时必须遵守此限制。拆分策略（子组件、按职责拆模块、提取类型到 `types.ts`）仅用于新建场景。
- **已有超长文件：** 禁止给已有的超长文件继续追加逻辑。如需修改，将新增逻辑写入新文件，通过导入方式引用。**不要主动拆分已有超长文件**，除非用户明确要求重构。

## 协作与沟通

- 回答简洁直接，只写技术内容；commit、issue、PR 评论中不用 emoji、不写客套话。
- 用户提问时先回答问题，再动手改代码或跑命令。
- 回应用户反馈或方案评审时，先明确说同意或不同意，再说改了什么。
- 解释非平凡设计按「问题 → 具体例子 → 方案 → 为什么必须这样做」的顺序，区分必要复杂度与可选复杂度。
- 用户指令与本文件冲突时，先请求明确确认，再执行。

## 代码质量红线

- 大范围改动前完整读相关文件，不凭搜索片段做判断。
- 禁止 `any`；确有必要时在旁注释理由。
- 使用第三方库的 API/类型前，查 `node_modules` 里的实际声明，不凭记忆猜。
- 禁止内联动态 import（`await import()`），一律顶层 import。
- 删除看似有意为之的功能或代码前，先问用户。
- 不做用户未要求的向后兼容（与焦土政策一致）。
- 不通过降级或删除代码来绕过过期依赖的类型错误；升级依赖。
- 临时脚本写到临时文件执行，用完删除；不在 bash 命令里嵌多行脚本。

## 验证纪律

- 代码改动（非文档）后运行 `npm run lint`，看完整输出，清零所有警告再提交。
- 新建或修改测试文件后，必须运行该测试并迭代到通过。
- 全量测试存在少量环境相关的存量失败（skill smoke、release manifest 等）。遇到失败先用 `git stash` 对照 HEAD 判断是否由你的改动引入：既不把存量失败算到自己头上，也不拿它为自己的回归开脱。

## 依赖纪律

- 依赖与 `bun.lock` 变更视同代码评审：只在确有必要时新增依赖，先确认仓库内没有现成能力。
- 直添依赖锁定精确版本；安装用 `bun install`。
- 含原生模块（better-sqlite3、node-pty）的依赖变更后，用 `npm run rebuild:electron-native` 重建。

## String Literal Constants

**Never use bare string literals** for values that act as discriminants, status codes, IPC channel names, mode selectors, or any string compared/switched against in multiple places. Instead, define a centralized `as const` object and derive the type from it.

### Pattern

```typescript
// In constants.ts (one per module, e.g. src/scheduledTask/constants.ts)
export const SessionTarget = {
  Main: 'main',
  Isolated: 'isolated',
} as const;
export type SessionTarget = (typeof SessionTarget)[keyof typeof SessionTarget];
```

### Rules

1. **One source of truth per module.** Each module that owns a set of string constants must have a `constants.ts` file. Consumer modules import both the value object and the type.
2. **Value construction and comparison must use constants.** Write `SessionTarget.Main`, not `'main'`. This applies to source files, test files, and any other TypeScript that references these values.
3. **Discriminant `kind` fields in interface definitions remain literal.** The `kind: 'at'` in `interface ScheduleAt` defines the discriminated union shape and must stay as a literal. The constant should match this value; consumers use the constant object for comparisons and construction.
4. **IPC channel names must be constants.** All `ipcMain.handle()` registrations and `ipcRenderer.invoke()` calls must reference an `IpcChannel` constant, never a bare string.
5. **Tests use constants too.** Test files must import and use the same constants — this is the primary defense against "modified the constant but forgot to update the test" drift.

### What NOT to constantize

- Platform-specific identifiers passed through from external sources (e.g., `'feishu'`, `'weixin'`, `'email'` as IM/email platform names from user config).
- One-off strings used in a single location with no comparison logic (e.g., error messages, log tags).
- CSS class names, HTML attributes, and other UI-layer strings managed by Tailwind/React.

### Existing reference

`src/scheduledTask/constants.ts` is the canonical example of this pattern, covering schedule kinds, payload kinds, delivery modes, session targets, wake modes, origin kinds, binding kinds, task status, IPC channels, and migration keys.

## Logging Guidelines

The main process uses `electron-log` via `src/main/logger.ts`, which intercepts all `console.*` calls and writes them to daily-rotated log files. **No additional logging library is needed** — use the standard `console` API everywhere in `src/main/`.

### Log Levels

Choose the level that matches the **significance** of the event:

| Level | API             | When to use                                                                                                                                                    |
| ----- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Error | `console.error` | Unrecoverable failures that need investigation — caught exceptions, broken invariants, data corruption                                                         |
| Warn  | `console.warn`  | Unexpected but recoverable situations — missing optional config, fallback behavior, degraded service                                                           |
| Info  | `console.log`   | Key lifecycle events worth keeping in production logs — service started/stopped, connection established/lost, session created/destroyed, configuration changed |
| Debug | `console.debug` | Development-time detail useful only when actively debugging — intermediate state, request/response payloads, loop iterations, sync cursors                     |

### Message Format

Log messages must read as **plain English sentences**, not as variable dumps.

**Tag**: Every message starts with a bracketed module tag: `[ModuleName]`.

```typescript
// Good — describes what happened in natural language
console.log('[ChannelSync] discovered 3 new channel sessions, notified 2 windows');
console.warn('[ChannelSync] session list returned unexpected type, skipping');
console.error('[ChannelSync] polling failed:', error);

// Bad — dumps variable names and raw values
console.log(
  '[ChannelSync] pollChannelSessions: got',
  sessions.length,
  'sessions, keys:',
  sessions.map(s => s?.key).join(', '),
);
console.log(
  '[Debug:syncChannelUserMessages] cursor:',
  cursor,
  'history entries:',
  historyEntries.length,
);
```

### Rules

- **No per-tick logging at info level.** Polling loops, sync cycles, and heartbeats that fire every few seconds must use `console.debug` or be removed entirely. A single summary line at info level is acceptable only when something meaningful changed (e.g. new session discovered, messages synced).
- **No function-entry logging.** Do not log "function X called with args Y" unless it is a rare or important operation. Routine calls (per-poll, per-message) must not produce info-level output.
- **No variable-name labels.** Write `received 5 messages` not `historyMessages: 5`. Write `session not found` not `sessionId: null`.
- **Include context only when useful.** An error log should include the relevant identifier (session ID, channel key) so the issue can be traced. A routine success log should not list every parameter.
- **Keep messages concise.** One line per event. Do not spread a single log across multiple `console.log` calls.
- **Errors must include the error object.** Always pass the caught error as the last argument: `console.error('[Module] operation failed:', error)`.
- **Use English for all log messages.** No Chinese or other non-ASCII text in logs.

### Before Submitting

When adding or modifying log statements, verify:

1. No new `console.log` calls inside hot loops or polling callbacks — use `console.debug` instead.
2. Messages read as natural English, not as stringified code.
3. Error/warn logs include enough context to diagnose without a debugger.

## Testing Guidelines

- Unit tests use [Vitest](https://vitest.dev/) and are **co-located** with the source files they cover.
- Test files must use the `.test.ts` extension and be placed next to the source file (e.g. `src/main/foo.ts` → `src/main/foo.test.ts`).
- Import test utilities from `vitest`: `import { test, expect } from 'vitest';`
- **Never** use `.test.mjs` or any other extension — `.test.ts` is the only accepted format.
- Run all tests: `npm test`. Filter by module: `npm test -- <name>` (e.g. `npm test -- logger`).
- Avoid importing Electron-only APIs (e.g. `electron-log`) in tests — inline any logic that depends on them.
- Validate UI changes manually by running `npm run electron:dev` and exercising key flows:
  - Cowork: start session, send prompts, approve/deny tool permissions, stop session
  - Artifacts: preview HTML, SVG, Mermaid diagrams, React components
  - Settings: theme switching, language switching
- Keep console warnings/errors clean; lint via `npm run lint` before submitting.

## Internationalization (i18n)

- **Never hardcode user-visible strings.** All UI text, labels, messages, and titles must go through the i18n system.
- **Renderer process**: use `t('key')` from `src/renderer/services/i18n.ts`. Add new keys to both the `zh` and `en` sections in that file.
- **Main process** (tray menu, session titles, notifications, etc.): use `t('key')` from `src/main/i18n.ts`. Add new keys to both the `zh` and `en` sections in that file.
- When adding a new key, always provide translations for **both** languages. If unsure of a translation, leave a comment like `// TODO: translate` rather than omitting the key.
- Error messages shown only in DevTools/logs (not visible to users) are exempt.

## Commit & Pull Request Guidelines

**All commit messages must follow the [Conventional Commits](https://www.conventionalcommits.org/) spec and be written in English.**

### Commit Message Format

```
type(scope): short imperative summary

Optional body in English markdown explaining *why* (not what).

Optional footer: BREAKING CHANGE: ..., Closes #123, etc.
```

**Types**: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `perf`, `style`, `ci`, `build`, `revert`

**Rules**:

- Subject line: lowercase, imperative mood, no trailing period, ≤72 chars
- Scope (optional): the affected area, e.g. `feat(cowork):`, `fix(im):`
- Body and footer must be in English markdown
- Breaking changes: add `!` after type/scope (`feat!:`) **and** a `BREAKING CHANGE:` footer

**Examples**:

```
feat(cowork): add streaming progress indicator
fix(sqlite): prevent duplicate session insert on retry
chore: bump version to 2026.3.18
```

- PRs should include a concise description, linked issue if applicable, and screenshots for UI changes.
- Call out any Electron-specific behavior changes (IPC, storage, windowing) in the PR description.
- 关联 issue 的修复在提交信息或 PR 中用 `closes #N`；多个 issue 时每个编号前都要重复关键词（`closes #1, closes #2`，共享关键词只关闭第一个）。

### Git 安全（多会话共处）

本仓库可能同时有多个 agent 会话在工作，工作区改动相互混杂。遵守：

- 只提交你在本会话改动的文件；`git add` 用显式路径，禁止 `git add -A` / `git add .`；提交前 `git status` 核对暂存区。
- 禁止 `git reset --hard`、`git checkout .`、`git clean -fd`、`git commit --no-verify`、`git push --force`——这些会摧毁其他会话的工作或绕过检查。
- `git stash` 谨慎使用：必须带 `-m` 说明，并在同一会话内尽快 pop。
- rebase/merge 冲突只解决你改过的文件；冲突出现在你没碰过的文件时，中止并问用户。
- 评审 PR 用 `gh pr view` / `gh pr diff` / `gh api`，不要仅为评审而 checkout 别人的分支。

## Agent-specific notes

### Built-in skills

The `SKILLs/` directory contains bundled skill definitions used by the Pi runtime. Do not confuse these with IDE/agent plugin skills.

### Claude Code

When using Claude Code with this repository, it reads `CLAUDE.md` (which points to this file) for context. For UI work, you may also use the following global Claude skills installed for this project:

- `shadcn/ui` — shadcn/ui component usage and styling rules.
- `vercel/ai-elements` — AI Elements chat components.
- `rongxinai-ui-adapter` — 项目适配层：`--zy-*` 主题映射、页面级组件选择矩阵、i18n 与常量约定（与 DESIGN.md「技能参考」一致）。

These global skills complement, not replace, the conventions in this file.

### Frontend design skill routing

- `design-taste-frontend` - brief inference, anti-slop review, and redesign guidance for landing pages, marketing pages, portfolios, and brand surfaces.
- `high-end-visual-design` - optional reference for premium visual direction and motion choreography when the brief explicitly calls for it.
- `frontend-ui-change-strategy` is the project-specific entry point for existing ZhiYuan Agent UI changes.
- For Work, Chat, Settings, MCP, Skills, local inference, and other product surfaces, use `DESIGN.md`, the shared UI components, and `rongxinai-ui-adapter` as the source of truth. Do not apply marketing-page defaults from the taste skills wholesale.
- For landing, marketing, portfolio, brand, or redesign work, read `design-taste-frontend` for brief inference and audit guidance.
- Read `high-end-visual-design` only when premium visual treatment or complex motion is an explicit requirement, and adapt its ideas to the project's tokens, components, accessibility, and performance rules.
- Conflict precedence is: `AGENTS.md` / `DESIGN.md` > project UI skills (`frontend-ui-change-strategy`, `rongxinai-ui-adapter`) > `design-taste-frontend` > `high-end-visual-design`.

> **主题 token 架构（已更新，旧的 hex/HSL 不兼容问题不复存在）**
>
> 主题插件现在是单一值来源：`src/renderer/theme/themes/*.ts` 提供完整 token，`themes.css` 由生成器生成，`shadcn-token-bridge.css` 仅保留基础规则。Tailwind 通过 `theme/css/tailwind.css` 的 inline 映射读取插件值。新组件优先使用语义 utility，禁止业务代码硬编码色值。新增风格按 `src/renderer/theme/README.md` 注册，同时提供浅色/深色。`bun run lint` 包含生成文件一致性及颜色归属检查。
>
> **CRITICAL: Tailwind v4 Variant Syntax**
>
> This project uses **Tailwind v4** (upgraded from v3.4). v4 supports shorthand variant syntax natively:
>
> | Variant             | Tailwind v4 (shorthand)     |
> | ------------------- | --------------------------- |
> | `data-*` attribute  | `data-active:bg-background` |
> | `data-*` with value | `data-checked:bg-primary`   |
> | `data-*` boolean    | `data-disabled:opacity-50`  |
>
> **Note**: The full syntax `data-[active]:bg-background` also works in v4, but shorthand is preferred. The upgrade codemod automatically converted v3-style `data-[active]:` to v4-style `data-active:` in all component files.
