# AGENTS.zh.md

本文件为在 RongxinAI 仓库中工作的编码智能体提供指导。

## 构建与开发命令

```bash
# 开发环境 - 启动 Vite 开发服务器（端口 5175）+ 带热重载的 Electron 应用
npm run electron:dev

# 带 OpenClaw 引擎的开发环境（首次运行时会克隆/构建 OpenClaw）
npm run electron:dev:openclaw

# 构建生产包（TypeScript + Vite）
npm run build

# 使用 oxlint 进行代码检查（配置：.oxlintrc.json）
npm run lint

# 使用 oxfmt 格式化（配置：.oxfmtrc.json）
npm run format

# 运行单元测试（Vitest）
npm test

# 仅编译 Electron 主进程
npm run compile:electron

# 打包分发（按平台）
npm run dist:mac        # macOS (.dmg)
npm run dist:win        # Windows (.exe)
npm run dist:linux      # Linux (.AppImage)

# 手动构建 OpenClaw 运行时
npm run openclaw:runtime:host   # 当前平台
```

**要求**：Node.js >=24 <25，Bun >=1.3（包管理器；使用 `bun install` 代替 `npm install`，锁文件为 `bun.lock`）。Windows 构建需要 PortableGit（详见 README.md）。

**OpenClaw 环境变量**：`OPENCLAW_SRC`（默认 `../openclaw`）、`OPENCLAW_FORCE_BUILD=1`（强制重建）、`OPENCLAW_SKIP_ENSURE=1`（跳过版本检出）。

## 架构概览

RongxinAI 是一款面向本地优先 AI Agent 工作流的 Electron + React 桌面应用。核心领域包括：
1. **Cowork 模式** - 以 OpenClaw 作为主要 Agent 运行时的 AI 辅助任务会话
2. **llama.cpp 本地推理** - 本地模型服务管理、模型启动选项，以及与 OpenClaw 的本地模型集成
3. **Skills 与 MCP** - 内置技能、远程技能市场以及 MCP 服务器配置
4. **Artifacts 系统** - 代码输出（HTML、SVG、React、Mermaid）的富预览

采用严格的进程隔离与 IPC 通信。

面向用户的产品文档和 UI 文案必须使用「知远智能体」名称。LobsterAI、RongxinAI、LEO、李知远均为已停用品牌名，不得在品牌面重新引入。OpenClaw、pi、llama.cpp 属于内部实现细节：不得在品牌或用户可见文案中暴露，Agent 运行时与本地推理一律表述为全栈自研。运行时存储、协议处理器、会话键和历史迁移路径中可能仍存在一些遗留标识符；除非任务明确包含兼容性迁移，否则不要重命名这些代码。

### 认证流程

1. **登录：** 打开系统浏览器 → Portal 登录页 → 登录成功 → 通过 deep link 回调返回 `code=<authCode>`
2. **换取令牌：** `POST /api/auth/exchange` 消费一次性 authCode → 返回 `accessToken`（2 小时）+ `refreshToken`（30 天）
3. **持久化：** SQLite kv 表 `auth_tokens` 存储双 token，应用重启后自动恢复登录态
4. **请求认证：** `fetchWithAuth()` 在每个 API 请求附加 `Authorization: Bearer <accessToken>`
5. **被动刷新：** 收到 HTTP 401 → 使用 refreshToken 调用 `POST /api/auth/refresh` → 获取新 accessToken → 重试原请求
6. **主动刷新：** 定期检查 accessToken 距 exp < 5 分钟 → 后台静默刷新，避免请求失败
7. **滚动续期：** 每次 refresh 签发新 refreshToken（新 30 天有效期），连续使用不掉线
8. **退出条件：** 连续 30 天不使用（refreshToken 过期）→ 清除本地 token → 用户需重新登录

**关键文件：**
- Token 存储与请求：`src/renderer/services/api.ts`（`fetchWithAuth()`、token 管理）
- 登录流程：`src/main/main.ts`（deep link callback 处理；legacy 协议名可能仍然存在）
- 持久化：`src/main/sqliteStore.ts`（kv 表存储 `auth_tokens`）

### 进程模型

**主进程** (`src/main/main.ts`)：
- 窗口生命周期管理
- 通过 `better-sqlite3` 使用 SQLite 存储（`src/main/sqliteStore.ts`）
- Agent 引擎路由（`src/main/libs/agentEngine/coworkEngineRouter.ts`）- 分发到 `openclawRuntimeAdapter.ts`（OpenClaw）
- llama.cpp 生命周期与本地推理管理（`src/main/libs/llamacppManager.ts`、`src/shared/llamacpp/`）
- 技能管理（`src/main/skillManager.ts`）
- MCP 服务器配置与市场集成
- IM/邮件网关（`src/main/im/`）- 公开渠道包括微信、企业微信、钉钉、飞书/Lark、QQ 和邮件。可能仍存在遗留/全局连接器代码；除非明确请求，否则不要在 UI 或文档中重新暴露。
- 用于 store、cowork 和 API 操作的 IPC 处理器（40+ 通道）
- 安全：启用上下文隔离，禁用 Node 集成，启用沙箱

**预加载脚本** (`src/main/preload.ts`)：
- 通过 `contextBridge` 暴露 `window.electron` API
- 包含用于会话管理和流式事件的 `cowork` 命名空间

**渲染进程** (`src/renderer/` 中的 React)：
- 所有 UI 和业务逻辑
- 仅通过 IPC 与主进程通信

### 关键目录

```
src/main/
├── main.ts              # 入口点，IPC 处理器
├── sqliteStore.ts       # SQLite 数据库（kv + cowork 表）
├── coworkStore.ts       # Cowork 会话/消息增删改查操作
├── skillManager.ts      # 技能加载与管理
├── im/                  # IM/邮件网关集成
└── libs/
    ├── agentEngine/
    │   ├── coworkEngineRouter.ts    # 路由到 OpenClaw 运行时
    │   └── openclawRuntimeAdapter.ts # OpenClaw 网关适配器
    ├── openclawEngineManager.ts # OpenClaw 运行时生命周期（安装/启动/状态）
    ├── openclawConfigSync.ts    # 将 cowork 配置同步到 OpenClaw 配置文件
    └── llamacppManager.ts       # llama.cpp 服务生命周期和配置

src/renderer/
├── types/cowork.ts      # Cowork 类型定义
├── store/slices/
│   ├── coworkSlice.ts   # Cowork 会话和流式状态
│   └── artifactSlice.ts # Artifacts 状态
├── services/
│   ├── cowork.ts        # Cowork 服务（IPC 包装器，Redux 集成）
│   ├── api.ts           # 带 SSE 流式传输的 LLM API
│   └── artifactParser.ts # Artifact 检测与解析
├── components/
│   ├── cowork/          # Cowork UI 组件
│   │   ├── CoworkView.tsx          # Cowork 主界面
│   │   ├── CoworkSessionList.tsx   # 会话侧边栏
│   │   ├── CoworkSessionDetail.tsx # 消息展示
│   │   └── CoworkPermissionModal.tsx # 工具权限 UI
│   ├── localInference/  # llama.cpp 本地推理 UI
│   ├── skills/          # 技能管理和市场 UI
│   ├── mcp/             # MCP 服务器配置 UI
│   └── artifacts/       # Artifact 渲染器

SKILLs/                  # Cowork 会话的自定义技能定义
├── skills.config.json   # 技能启用/排序配置
├── docx/                # Word 文档生成技能
├── xlsx/                # Excel 技能
├── pptx/                # PowerPoint 技能
└── ...
```

### 数据流

1. **初始化**：`src/renderer/App.tsx` → `coworkService.init()` → 通过 IPC 加载配置/会话 → 设置流监听器
2. **Cowork 会话**：用户发送 prompt → `coworkService.startSession()` → IPC 到主进程 → `CoworkEngineRouter` → OpenClaw 网关（主）→ 流式事件通过 IPC 返回渲染进程 → Redux 更新
3. **工具权限**：Agent 请求使用工具 → `CoworkEngineRouter` 发出 `permissionRequest` → UI 显示 `CoworkPermissionModal` → 用户批准/拒绝 → 结果返回引擎
4. **持久化**：Cowork 会话存储在 SQLite（`cowork_sessions`、`cowork_messages` 表）
5. **本地推理**：渲染进程调用 llama.cpp IPC → 主进程管理 `llama-server`、模型安装/列表/加载状态，以及服务/模型启动参数

### Cowork 系统

Cowork 功能提供 AI 辅助编程会话：

**执行模式** (`CoworkExecutionMode`)：
- `auto` - 根据上下文自动选择
- `local` - 直接在本地机器上运行工具

**Agent 引擎**（通过 cowork 配置中的 `agentEngine` 配置）：
- `openclaw` - OpenClaw 网关（`openclawRuntimeAdapter.ts`）；需要 bundled OpenClaw 运行时正在运行。引擎生命周期由 `OpenClawEngineManager` 管理，状态为：`not_installed → ready → starting → running | error`

`CoworkEngineRouter` 向渲染进程暴露流式事件，与引擎无关。引擎特定 IPC：`openclaw:engine:*` 通道独立于 `cowork:*` 会话通道管理运行时生命周期。

**记忆系统**：基于文件的持久记忆存储在 OpenClaw 工作目录中：
- `MEMORY.md` - 持久事实、偏好和决策；每次会话开始时自动加载。
- `memory/YYYY-MM-DD.md` - 近期上下文的每日笔记。
- `USER.md` / `SOUL.md` - 会话启动时读取的用户画像和 Agent 个性文件。
- 当用户发出明确的 "remember" 指令或 Agent 自行记录重要发现时，通过 Agent 的 `write` 工具写入。无后台提取或置信度评分。
- 设置面板提供 `MEMORY.md` 条目的手动增删改 GUI。

**流式事件**（从主进程到渲染进程的 IPC）：
- `message` - 新消息添加到会话
- `messageUpdate` - 现有消息的流式内容更新
- `permissionRequest` - 工具需要用户批准
- `complete` - 会话执行完成
- `error` - 会话遇到错误

**关键 IPC 通道**：
- `cowork:startSession`、`cowork:continueSession`、`cowork:stopSession`
- `cowork:getSession`、`cowork:listSessions`、`cowork:deleteSession`
- `cowork:respondToPermission`、`cowork:getConfig`、`cowork:setConfig`

### 关键模式

- **流式响应**：provider 聊天 API 可使用 SSE 与 `onProgress` 回调进行实时消息更新
- **Cowork 流式传输**：使用 IPC 事件监听器（`onStreamMessage`、`onStreamMessageUpdate` 等）进行双向通信
- **Markdown 渲染**：`react-markdown` 配合 `remark-gfm`、`remark-math`、`rehype-katex` 渲染 GitHub Markdown 和 LaTeX
- **主题系统**：基于 class 的 Tailwind 暗色模式，将 `dark` class 应用于 `<html>` 元素
- **i18n**：`services/i18n.ts` 中的简单键值翻译，支持中文（默认）和英文。首次运行时从系统语言环境自动检测语言。
- **路径别名**：Vite 配置中 `@` 映射到 `src/renderer/`。
- **Skills**：`SKILLs/` 目录中的自定义技能定义，通过 `skills.config.json` 配置
- **llama.cpp 参数**：服务级选项控制托管的 `llama-server` 进程；模型级选项在加载或运行模型时传入。

### Artifacts 系统

Artifacts 功能提供类似 Claude artifacts 的代码输出富预览：

**支持类型**：
- `html` - 在沙盒 iframe 中渲染的完整 HTML 页面
- `svg` - 经 DOMPurify 消毒并带缩放控件的 SVG 图形
- `mermaid` - 通过 Mermaid.js 渲染的流程图、时序图、类图
- `react` - 在隔离 iframe 中用 Babel 编译的 React/JSX 组件
- `code` - 带行号的语法高亮代码

**检测方法**：
1. 显式标记：` ```artifact:html title="My Page" `
2. 启发式检测：分析代码块语言和内容模式

**UI 组件**：
- 右侧面板（300-800px 可调整宽度）
- 头部带类型图标、标题、复制/下载/关闭按钮
- 消息中的 Artifact 徽章用于切换 artifact

**安全**：
- HTML：`sandbox="allow-scripts"`，无 `allow-same-origin`
- SVG：DOMPurify 移除所有脚本内容
- React：完全隔离的 iframe，无网络访问
- Mermaid：`securityLevel: 'strict'` 配置

### 配置

- 应用配置存储在 SQLite `kv` 表
- Cowork 配置存储在 `cowork_config` 表（workingDirectory、systemPrompt、executionMode、**agentEngine**）
- Cowork 会话和消息存储在 `cowork_sessions` 和 `cowork_messages` 表
- 计划任务元数据存储在 `scheduled_task_meta` 表（origin 和 binding 信息）；任务定义由 OpenClaw 管理
- 数据库文件：当前使用用户数据目录中配置的应用 SQLite 文件名。旧版本安装可能仍使用 `lobsterai.sqlite`；没有迁移计划不要更改存储名称。
- OpenClaw 固定版本声明在 `package.json` 的 `"openclaw": { "version": "...", "repo": "..." }` 下；升级时更新版本字段并重新运行。

### TypeScript 配置

- `tsconfig.json`：React/渲染进程代码（ES2020，ESNext 模块）
- `electron-tsconfig.json`：Electron 主进程（CommonJS 输出到 `dist-electron/`）

### 关键依赖

- OpenClaw（`Resources/cfmind` 下的 bundled 运行时）- Cowork 会话的主要 Agent 引擎
- `better-sqlite3` - 用于持久化的 SQLite 数据库
- `react-markdown`、`remark-gfm`、`rehype-katex` - 支持数学公式的 Markdown 渲染
- `mermaid` - 图表渲染
- `dompurify` - SVG/HTML 消毒

## 编码风格与命名约定

- 使用 TypeScript、函数式 React 组件和 Hooks；当逻辑不是 UI 专属时，放在 `src/renderer/services/` 中。
- 匹配现有格式：2 空格缩进、单引号、分号。
- 命名：组件使用 `PascalCase`（例如 `Chat.tsx`），函数/变量使用 `camelCase`，Redux slices 使用 `*Slice.ts`。
- Tailwind CSS 是主要样式方案；优先使用 utility class 而非自定义 CSS。

### 文件长度限制

- **单文件行数上限：** 单个文件最好不要超过 **800 行**，最多不能超过 **1000 行**。
- **仅适用于新增文件：** 创建新文件时必须遵守此限制。拆分策略（子组件、按职责拆模块、提取类型到 `types.ts`）仅用于新建场景。
- **已有超长文件：** 禁止给已有的超长文件继续追加逻辑。如需修改，将新增逻辑写入新文件，通过导入方式引用。**不要主动拆分已有超长文件**，除非用户明确要求重构。

## 字符串字面量常量

**永远不要使用裸字符串字面量**作为判别值、状态码、IPC 通道名、模式选择器，或任何在多个地方被比较/切换的字符串。相反，定义一个中心化的 `as const` 对象并从中派生类型。

### 模式

```typescript
// 在 constants.ts 中（每个模块一个，例如 src/scheduledTask/constants.ts）
export const SessionTarget = {
  Main: 'main',
  Isolated: 'isolated',
} as const;
export type SessionTarget = typeof SessionTarget[keyof typeof SessionTarget];
```

### 规则

1. **每个模块一个真相来源。** 拥有一组字符串常量的每个模块必须有一个 `constants.ts` 文件。消费模块同时导入值对象和类型。
2. **值构造和比较必须使用常量。** 写 `SessionTarget.Main`，而不是 `'main'`。这适用于源文件、测试文件以及引用这些值的任何其他 TypeScript。
3. **接口定义中的判别 `kind` 字段保持字面量。** `interface ScheduleAt` 中的 `kind: 'at'` 定义了判别联合形状，必须保持为字面量。常量应与此值匹配；消费者使用常量对象进行比较和构造。
4. **IPC 通道名必须是常量。** 所有 `ipcMain.handle()` 注册和 `ipcRenderer.invoke()` 调用必须引用 `IpcChannel` 常量，绝不能是裸字符串。
5. **测试也使用常量。** 测试文件必须导入并使用相同常量 —— 这是防止"修改了常量但忘记更新测试"漂移的主要防御。

### 不需要常量化的内容

- 从外部来源传入的特定平台标识符（例如 IM/邮件平台名称如 `'feishu'`、`'weixin'`、`'email'`，来自用户配置）。
- 单处使用且无比较逻辑的一次性字符串（例如错误消息、日志标签）。
- CSS 类名、HTML 属性以及 Tailwind/React 管理的其他 UI 层字符串。

### 现有参考

`src/scheduledTask/constants.ts` 是该模式的典范，涵盖计划种类、payload 种类、投递模式、会话目标、唤醒模式、origin 种类、binding 种类、任务状态、IPC 通道和迁移键。

## 日志指南

主进程通过 `src/main/logger.ts` 使用 `electron-log`，它会拦截所有 `console.*` 调用并将其写入按日轮转的日志文件。**不需要额外的日志库** —— 在 `src/main/` 的任何地方都使用标准 `console` API。

### 日志级别

选择匹配事件**重要性**的级别：

| 级别 | API | 何时使用 |
|------|-----|---------|
| Error | `console.error` | 需要调查的不可恢复失败 —— 捕获的异常、破坏的不变量、数据损坏 |
| Warn | `console.warn` | 意外但可恢复的情况 —— 缺失的可选配置、回退行为、降级服务 |
| Info | `console.log` | 值得保留在生产日志中的关键生命周期事件 —— 服务启动/停止、连接建立/丢失、会话创建/销毁、配置变更 |
| Debug | `console.debug` | 仅在主动调试时有用的开发时细节 —— 中间状态、请求/响应 payload、循环迭代、同步游标 |

### 消息格式

日志消息必须读起来像** plain English 句子**，而不是变量转储。

**标签**：每条消息以带括号的模块标签开头：`[ModuleName]`。

```typescript
// 好 —— 用自然语言描述发生了什么
console.log('[ChannelSync] discovered 3 new channel sessions, notified 2 windows');
console.warn('[ChannelSync] session list returned unexpected type, skipping');
console.error('[ChannelSync] polling failed:', error);

// 差 —— 转储变量名和原始值
console.log('[ChannelSync] pollChannelSessions: got', sessions.length, 'sessions, keys:', sessions.map(s => s?.key).join(', '));
console.log('[Debug:syncChannelUserMessages] cursor:', cursor, 'history entries:', historyEntries.length);
```

### 规则

- **info 级别不要每 tick 记录。** 轮询循环、同步周期和每隔几秒触发的心跳必须改用 `console.debug` 或完全移除。仅当发生有意义变化（例如发现新会话、消息同步）时，才允许单条 info 级别摘要。
- **不要记录函数入口。** 除非操作罕见或重要，否则不要记录"函数 X 以参数 Y 被调用"。常规调用（每次轮询、每条消息）不得产生 info 级别输出。
- **不要使用变量名标签。** 写 `received 5 messages` 而不是 `historyMessages: 5`。写 `session not found` 而不是 `sessionId: null`。
- **仅在有用时包含上下文。** 错误日志应包含相关标识符（会话 ID、通道键）以便追踪。常规成功日志不应列出每个参数。
- **保持消息简洁。** 每个事件一行。不要把单个日志分散到多个 `console.log` 调用。
- **错误必须包含错误对象。** 始终将捕获的错误作为最后一个参数传递：`console.error('[Module] operation failed:', error)`。
- **所有日志消息使用英文。** 日志中不要出现中文或其他非 ASCII 字符。

### 提交前检查

添加或修改日志语句时，确认：
1. 热点循环或轮询回调中没有新的 `console.log` —— 改用 `console.debug`。
2. 消息读起来像自然英语，而不是字符串化的代码。
3. 错误/警告日志包含足够上下文，无需调试器即可诊断。

## 测试指南

- 单元测试使用 [Vitest](https://vitest.dev/)，并与所覆盖的源文件**同地放置**。
- 测试文件必须使用 `.test.ts` 扩展名，并放在源文件旁边（例如 `src/main/foo.ts` → `src/main/foo.test.ts`）。
- 从 `vitest` 导入测试工具：`import { test, expect } from 'vitest';`
- **绝不**使用 `.test.mjs` 或任何其他扩展名 —— `.test.ts` 是唯一接受的格式。
- 运行所有测试：`npm test`。按模块过滤：`npm test -- <name>`（例如 `npm test -- logger`）。
- 避免在测试中导入 Electron 专用 API（例如 `electron-log`）—— 内联任何依赖它们的逻辑。
- 通过运行 `npm run electron:dev` 并演练关键流程来手动验证 UI 变更：
  - Cowork：启动会话、发送 prompt、批准/拒绝工具权限、停止会话
  - Artifacts：预览 HTML、SVG、Mermaid 图表、React 组件
  - Settings：主题切换、语言切换
- 保持控制台警告/错误干净；提交前通过 `npm run lint` 检查。

## 国际化（i18n）

- **永远不要硬编码用户可见字符串。** 所有 UI 文本、标签、消息和标题都必须通过 i18n 系统。
- **渲染进程**：使用 `src/renderer/services/i18n.ts` 中的 `t('key')`。在该文件的 `zh` 和 `en` 部分添加新键。
- **主进程**（托盘菜单、会话标题、通知等）：使用 `src/main/i18n.ts` 中的 `t('key')`。在该文件的 `zh` 和 `en` 部分添加新键。
- 添加新键时，始终提供**两种语言**的翻译。如果不确定翻译，请留下 `// TODO: translate` 注释，而不是省略该键。
- 仅显示在 DevTools/日志中的错误消息（用户不可见）可豁免。

## 提交与 Pull Request 指南

**所有提交消息必须遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范并用英文书写。**

### 提交消息格式

```
type(scope): short imperative summary

Optional body in English markdown explaining *why* (not what).

Optional footer: BREAKING CHANGE: ..., Closes #123, etc.
```

**类型**：`feat`、`fix`、`refactor`、`chore`、`docs`、`test`、`perf`、`style`、`ci`、`build`、`revert`

**规则**：
- 主题行：小写、祈使语气、无尾句点、≤72 字符
- 范围（可选）：受影响区域，例如 `feat(cowork):`、`fix(im):`
- 正文和页脚必须使用英文 markdown
- 破坏性变更：在 type/scope 后加 `!`（`feat!:`）**并且**添加 `BREAKING CHANGE:` 页脚

**示例**：
```
feat(cowork): add streaming progress indicator
fix(sqlite): prevent duplicate session insert on retry
chore: bump version to 2026.3.18
```

- PR 应包含简洁描述、相关 issue 链接，以及 UI 变更的截图。
- 在 PR 描述中说明任何 Electron 专用行为变更（IPC、存储、窗口）。

## Agent 专用说明

### 内置 skills

`SKILLs/` 目录包含 Cowork 运行时使用的 OpenClaw 技能定义。请勿将其与 IDE/Agent 插件 skill 混淆。

### Claude Code

在 Claude Code 中使用本仓库时，它会读取 `CLAUDE.md`（指向本文件）获取上下文。对于 UI 工作，你还可以使用为本项目安装的全局 Claude skills：

- `shadcn/ui` — shadcn/ui 组件使用和样式规则。
- `vercel/ai-elements` — AI Elements 聊天组件。
- `rongxinai-ui-adapter` — RongxinAI 专用约束和 lobster 主题映射。

这些全局 skills 补充本文件中的约定，而不是替代。
