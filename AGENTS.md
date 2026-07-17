# AGENTS.md

This file provides guidance to coding agents when working with code in this repository.

## Build and Development Commands

```bash
# Development - starts Vite dev server (port 5175) + Electron app with hot reload
npm run electron:dev

# Development with OpenClaw engine (clones/builds OpenClaw on first run)
npm run electron:dev:openclaw

# Build production bundle (TypeScript + Vite)
npm run build

# Lint with ESLint
npm run lint

# Run unit tests (Vitest)
npm test

# Compile Electron main process only
npm run compile:electron

# Package for distribution (platform-specific)
npm run dist:mac        # macOS (.dmg)
npm run dist:win        # Windows (.exe)
npm run dist:linux      # Linux (.AppImage)

# Build OpenClaw runtime manually
npm run openclaw:runtime:host   # current platform
```

**Requirements**: Node.js >=24 <25. Windows builds require PortableGit (see README.md for setup).

**OpenClaw env vars**: `OPENCLAW_SRC` (default `../openclaw`), `OPENCLAW_FORCE_BUILD=1` (force rebuild), `OPENCLAW_SKIP_ENSURE=1` (skip version checkout).

## Architecture Overview

RongxinAI is an Electron + React desktop application for local-first AI Agent workflows. Its core areas are:
1. **Cowork Mode** - AI-assisted task sessions powered by OpenClaw as the primary agent runtime
2. **llama.cpp Local Inference** - local model service management, model launch options, and local model integration with OpenClaw
3. **Skills and MCP** - built-in skills, remote skill marketplace, and MCP server configuration
4. **Artifacts System** - rich preview of code outputs (HTML, SVG, React, Mermaid)

Uses strict process isolation with IPC communication.

Public-facing product documentation should use the RongxinAI name. Some legacy identifiers may still exist in runtime storage, protocol handlers, session keys, and historical migration paths; do not rename those in code unless the task explicitly includes a compatibility migration.

### Authentication Flow

1. **登录：** 打开系统浏览器 → Portal 登录页 → 登录成功 → deep link callback with `code=<authCode>`
2. **换取令牌：** `POST /api/auth/exchange` 消费一次性 authCode → 返回 `accessToken`(2h) + `refreshToken`(30d)
3. **持久化：** SQLite kv store `auth_tokens` 存储双 token，应用重启后自动恢复登录态
4. **请求认证：** `fetchWithAuth()` 在每个 API 请求附加 `Authorization: Bearer <accessToken>`
5. **被动刷新：** 收到 HTTP 401 → 使用 refreshToken 调用 `POST /api/auth/refresh` → 获取新 accessToken → 重试原请求
6. **主动刷新：** 定期检查 accessToken 距 exp < 5 分钟 → 后台静默刷新，避免请求失败
7. **滚动续期：** 每次 refresh 签发新 refreshToken（新 30 天有效期），连续使用不掉线
8. **退出条件：** 连续 30 天不使用（refreshToken 过期）→ 清除本地 token → 用户需重新登录

**关键文件：**
- Token 存储与请求：`src/renderer/services/api.ts`（`fetchWithAuth()`、token 管理）
- 登录流程：`src/main/main.ts`（deep link callback 处理；legacy protocol names may still be present）
- 持久化：`src/main/sqliteStore.ts`（kv 表存储 `auth_tokens`）

### Process Model

**Main Process** (`src/main/main.ts`):
- Window lifecycle management
- SQLite storage via `better-sqlite3` (`src/main/sqliteStore.ts`)
- Agent engine routing (`src/main/libs/agentEngine/coworkEngineRouter.ts`) - dispatches to `openclawRuntimeAdapter.ts` (OpenClaw)
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

### Key Directories

```
src/main/
├── main.ts              # Entry point, IPC handlers
├── sqliteStore.ts       # SQLite database (kv + cowork tables)
├── coworkStore.ts       # Cowork session/message CRUD operations
├── skillManager.ts      # Skill loading and management
├── im/                  # IM/email gateway integrations
└── libs/
    ├── agentEngine/
    │   ├── coworkEngineRouter.ts    # Routes to OpenClaw runtime
    │   └── openclawRuntimeAdapter.ts # OpenClaw gateway adapter
    ├── openclawEngineManager.ts # OpenClaw runtime lifecycle (install/start/status)
    ├── openclawConfigSync.ts    # Syncs cowork config → OpenClaw config files
    ├── llamacppManager.ts       # llama.cpp service lifecycle and configuration

src/renderer/
├── types/cowork.ts      # Cowork type definitions
├── store/slices/
│   ├── coworkSlice.ts   # Cowork sessions and streaming state
│   └── artifactSlice.ts # Artifacts state
├── services/
│   ├── cowork.ts        # Cowork service (IPC wrapper, Redux integration)
│   ├── api.ts           # LLM API with SSE streaming
│   └── artifactParser.ts # Artifact detection and parsing
├── components/
│   ├── cowork/          # Cowork UI components
│   │   ├── CoworkView.tsx          # Main cowork interface
│   │   ├── CoworkSessionList.tsx   # Session sidebar
│   │   ├── CoworkSessionDetail.tsx # Message display
│   │   └── CoworkPermissionModal.tsx # Tool permission UI
│   ├── localInference/  # llama.cpp local inference UI
│   ├── skills/          # Skill management and marketplace UI
│   ├── mcp/             # MCP server configuration UI
│   └── artifacts/       # Artifact renderers

SKILLs/                  # Custom skill definitions for cowork sessions
├── skills.config.json   # Skill enable/order configuration
├── docx/                # Word document generation skill
├── xlsx/                # Excel skill
├── pptx/                # PowerPoint skill
└── ...
```

### Data Flow

1. **Initialization**: `src/renderer/App.tsx` → `coworkService.init()` → loads config/sessions via IPC → sets up stream listeners
2. **Cowork Session**: User sends prompt → `coworkService.startSession()` → IPC to main → `CoworkEngineRouter` → OpenClaw gateway (primary) → streaming events back to renderer via IPC → Redux updates
3. **Tool Permissions**: Agent requests tool use → `CoworkEngineRouter` emits `permissionRequest` → UI shows `CoworkPermissionModal` → user approves/denies → result sent back to engine
4. **Persistence**: Cowork sessions stored in SQLite (`cowork_sessions`, `cowork_messages` tables)
5. **Local Inference**: Renderer invokes llama.cpp IPC → main process manages `llama-server`, model install/list/load state, and service/model launch parameters

### Cowork System

The Cowork feature provides AI-assisted coding sessions:

**Execution Modes** (`CoworkExecutionMode`):
- `auto` - Automatically choose based on context
- `local` - Run tools directly on the local machine

**Agent Engine** (configured via `agentEngine` in cowork config):
- `openclaw` - OpenClaw gateway (`openclawRuntimeAdapter.ts`); requires the bundled OpenClaw runtime to be running. Engine lifecycle managed by `OpenClawEngineManager` with states: `not_installed → ready → starting → running | error`

The `CoworkEngineRouter` exposes stream events to the renderer, which is engine-agnostic. Engine-specific IPC: `openclaw:engine:*` channels manage runtime lifecycle separately from `cowork:*` session channels.

**Memory System**: File-based persistent memory stored in the OpenClaw working directory:
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

The Artifacts feature provides rich preview of code outputs similar to Claude's artifacts:

**Supported Types**:
- `html` - Full HTML pages rendered in sandboxed iframe
- `svg` - SVG graphics with DOMPurify sanitization and zoom controls
- `mermaid` - Flowcharts, sequence diagrams, class diagrams via Mermaid.js
- `react` - React/JSX components compiled with Babel in isolated iframe
- `code` - Syntax highlighted code with line numbers

**Detection Methods**:
1. Explicit markers: ` ```artifact:html title="My Page" `
2. Heuristic detection: Analyzes code block language and content patterns

**UI Components**:
- Right-side panel (300-800px resizable width)
- Header with type icon, title, copy/download/close buttons
- Artifact badges in messages to switch between artifacts

**Security**:
- HTML: `sandbox="allow-scripts"` with no `allow-same-origin`
- SVG: DOMPurify removes all script content
- React: Completely isolated iframe with no network access
- Mermaid: `securityLevel: 'strict'` configuration

### Configuration

- App config stored in SQLite `kv` table
- Cowork config stored in `cowork_config` table (workingDirectory, systemPrompt, executionMode, **agentEngine**)
- Cowork sessions and messages stored in `cowork_sessions` and `cowork_messages` tables
- Scheduled task metadata stored in `scheduled_task_meta` table (origin and binding info); task definitions are managed by OpenClaw
- Database file: currently uses the configured app SQLite filename in the user data directory. Legacy installations may still use `lobsterai.sqlite`; do not change storage names without a migration plan.
- OpenClaw pinned version declared in `package.json` under `"openclaw": { "version": "...", "repo": "..." }`; update the version field and re-run to upgrade

### TypeScript Configuration

- `tsconfig.json`: React/renderer code (ES2020, ESNext modules)
- `electron-tsconfig.json`: Electron main process (CommonJS output to `dist-electron/`)

### Key Dependencies

- OpenClaw (bundled runtime under `Resources/cfmind`) - Primary agent engine for cowork sessions
- `better-sqlite3` - SQLite database for persistence
- `react-markdown`, `remark-gfm`, `rehype-katex` - Markdown rendering with math support
- `mermaid` - Diagram rendering
- `dompurify` - SVG/HTML sanitization

## UI Component Libraries

项目使用两套 UI 组件库。**所有 UI 代码必须优先使用这些组件，禁止自造轮子。**

### shadcn/ui（基础组件）

位于 `src/shared/components/ui/`，基于 [shadcn/ui](https://ui.shadcn.com/)（base-nova 风格，lucide 图标库）。

| 组件 | 用途 |
|------|------|
| `button`, `button-group` | 按钮 |
| `input`, `input-group`, `textarea` | 输入框 |
| `select` | 下拉选择 |
| `checkbox`, `radio-group`, `switch` | 选择控件 |
| `dialog`, `sheet`, `popover`, `hover-card` | 弹层 |
| `tooltip` | 提示 |
| `dropdown-menu`, `command` | 菜单 |
| `tabs` | 标签页 |
| `card` | 卡片 |
| `sidebar` | 侧边栏 |
| `table` | 表格 |
| `badge` | 徽标 |
| `avatar` | 头像 |
| `label` | 标签 |
| `separator` | 分隔线 |
| `scroll-area` | 滚动区域 |
| `collapsible` | 折叠面板 |
| `breadcrumb` | 面包屑 |
| `skeleton`, `spinner` | 加载态 |
| `sonner` | Toast 通知 |

### ai-elements（对话组件）

位于 `src/shared/components/ai-elements/`，用于聊天/AI 对话场景。

| 组件 | 用途 |
|------|------|
| `conversation` | 对话容器 |
| `message` | 消息气泡 |
| `prompt-input` | 输入框 |
| `code-block` | 代码块渲染 |
| `reasoning` | 推理过程展示 |
| `tool` | 工具调用展示 |
| `attachments` | 附件预览 |
| `sources` | 来源引用 |
| `suggestion` | 建议问题 |
| `shimmer` | 加载闪烁效果 |
| `terminal` | 终端输出 |

### 规则

1. **先查再写。** 写任何 UI 前，先检查上面两个目录是否有现成组件可用。
2. **禁止自造基础组件。** 不要自己写 button / dialog / select / tooltip / tabs / popover 等，shadcn/ui 已有。
3. **图标用 lucide-react。** 禁止手写 SVG 图标组件（项目已删除 30+ 个自定义 icon，全部迁移到 lucide）。
4. **对话 UI 用 ai-elements。** 聊天、消息、推理展示等场景必须用 ai-elements，不要自己拼。

### 样式工具

- 样式合并：`cn()` from `@shared/lib/utils`（clsx + tailwind-merge）
- 组件样式覆写：用 Tailwind className，不要写独立 CSS

### 导入路径

```typescript
// shadcn/ui
import { Button } from '@shared/components/ui/button';
import { Dialog, DialogContent, DialogHeader } from '@shared/components/ui/dialog';

// ai-elements
import { Message } from '@shared/components/ai-elements/message';
import { Conversation } from '@shared/components/ai-elements/conversation';

// 工具
import { cn } from '@shared/lib/utils';

// 图标
import { Settings, Plus, Trash } from 'lucide-react';
```

## Coding Style & Naming Conventions

- Use TypeScript, functional React components, and Hooks; keep logic in `src/renderer/services/` when it is not UI-specific.
- Match existing formatting: 2-space indentation, single quotes, and semicolons.
- Naming: `PascalCase` for components (e.g., `Chat.tsx`), `camelCase` for functions/vars, and `*Slice.ts` for Redux slices.
- Tailwind CSS v4 is the primary styling approach; prefer utility classes over bespoke CSS. Configuration is CSS-first via `@theme` in `src/renderer/index.css` (no `tailwind.config.js`).

### File Length Limit

- **单文件行数上限：** 单个文件最好不要超过 **800 行**，最多不能超过 **1000 行**。
- **仅适用于新增文件：** 创建新文件时必须遵守此限制。拆分策略（子组件、按职责拆模块、提取类型到 `types.ts`）仅用于新建场景。
- **已有超长文件：** 禁止给已有的超长文件继续追加逻辑。如需修改，将新增逻辑写入新文件，通过导入方式引用。**不要主动拆分已有超长文件**，除非用户明确要求重构。

## String Literal Constants

**Never use bare string literals** for values that act as discriminants, status codes, IPC channel names, mode selectors, or any string compared/switched against in multiple places. Instead, define a centralized `as const` object and derive the type from it.

### Pattern

```typescript
// In constants.ts (one per module, e.g. src/scheduledTask/constants.ts)
export const SessionTarget = {
  Main: 'main',
  Isolated: 'isolated',
} as const;
export type SessionTarget = typeof SessionTarget[keyof typeof SessionTarget];
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

| Level | API | When to use |
|-------|-----|-------------|
| Error | `console.error` | Unrecoverable failures that need investigation — caught exceptions, broken invariants, data corruption |
| Warn | `console.warn` | Unexpected but recoverable situations — missing optional config, fallback behavior, degraded service |
| Info | `console.log` | Key lifecycle events worth keeping in production logs — service started/stopped, connection established/lost, session created/destroyed, configuration changed |
| Debug | `console.debug` | Development-time detail useful only when actively debugging — intermediate state, request/response payloads, loop iterations, sync cursors |

### Message Format

Log messages must read as **plain English sentences**, not as variable dumps.

**Tag**: Every message starts with a bracketed module tag: `[ModuleName]`.

```typescript
// Good — describes what happened in natural language
console.log('[ChannelSync] discovered 3 new channel sessions, notified 2 windows');
console.warn('[ChannelSync] session list returned unexpected type, skipping');
console.error('[ChannelSync] polling failed:', error);

// Bad — dumps variable names and raw values
console.log('[ChannelSync] pollChannelSessions: got', sessions.length, 'sessions, keys:', sessions.map(s => s?.key).join(', '));
console.log('[Debug:syncChannelUserMessages] cursor:', cursor, 'history entries:', historyEntries.length);
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

## Agent-specific notes

### Built-in skills

The `SKILLs/` directory contains OpenClaw skill definitions used by the Cowork runtime. Do not confuse these with IDE/agent plugin skills.

### Claude Code

When using Claude Code with this repository, it reads `CLAUDE.md` (which points to this file) for context. For UI work, you may also use the following global Claude skills installed for this project:

- `shadcn/ui` — shadcn/ui component usage and styling rules.
- `vercel/ai-elements` — AI Elements chat components.
- `rongxinai-ui-adapter` — RongxinAI-specific constraints and lobster theme mapping.

These global skills complement, not replace, the conventions in this file.

> **CRITICAL: Color Format Incompatibility**
>
> shadcn/ui components expect HSL color values in CSS variables (e.g., `--primary: 217 91% 60%`), and Tailwind generates classes like `bg-primary` as `hsl(var(--primary))`. However, RongxinAI's lobster theme stores colors as **hex values** (`--lobster-primary: #3B82F6`), and the bridge maps them one-to-one (`--primary: var(--lobster-primary)`).
>
> This means `hsl(var(--primary))` → `hsl(#3B82F6)` → **invalid CSS** — the browser silently drops the declaration. Any shadcn component using `bg-primary`, `bg-input`, `bg-secondary`, `text-primary`, etc. may appear to have no color at all.
>
> **When debugging invisible component styles:**
> 1. Open DevTools and check if the element has a `background-color` or `color` set to `hsl(...)` with a hex value inside — this is the root cause.
> 2. Fix by writing a CSS rule that reads `var(--lobster-*)` directly without the `hsl()` wrapper.
> 3. Do NOT add className overrides on the component — `className` is for layout only per the shadcn skill. Always fix color issues in the global CSS file (`src/renderer/index.css`).
>
> Example fix for Switch component:
> ```css
> /* index.css */
> [data-slot="switch"][data-unchecked] {
>   background-color: var(--lobster-surface-raised);
> }
> [data-slot="switch"][data-checked] {
>   background-color: var(--lobster-primary);
> }
> ```
>
> **CRITICAL: Tailwind v4 Variant Syntax**
>
> This project uses **Tailwind v4** (upgraded from v3.4). v4 supports shorthand variant syntax natively:
>
> | Variant | Tailwind v4 (shorthand) |
> |---------|------------------------|
> | `data-*` attribute | `data-active:bg-background` |
> | `data-*` with value | `data-checked:bg-primary` |
> | `data-*` boolean | `data-disabled:opacity-50` |
>
> **Note**: The full syntax `data-[active]:bg-background` also works in v4, but shorthand is preferred. The upgrade codemod automatically converted v3-style `data-[active]:` to v4-style `data-active:` in all component files.
