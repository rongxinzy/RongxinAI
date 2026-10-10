# AGENTS.md

本仓库编码 agent 指南。CLAUDE.md 是本文件的软链接。用户指令与本文件冲突时，先请求明确确认再执行。

## 核心原则

1. **Pi First。** `src/main/libs/agentEngine/piRuntimeAdapter.ts` 是唯一执行内核（Work/Chat/Channel/Cron 全走它）。新能力优先用 Pi 原生机制，不在 harness 层重造。
2. **Harness 不得劣化 Pi。** 提示注入、工具包装、闸门、拦截、强制纠偏等不得浪费 token、制造模型摩擦或扭曲行为基线；被证明劣化的机制直接移除，不加固。反例：强制模型先调 `set_task_output` 声明交付物（#786 引入、#917 移除），不得重新引入。
3. **设计合规是前端 P0 门禁。** 见下文「前端设计规则」。设计违规即阻断缺陷，功能可用或测试通过不能抵消。

## 命令

```bash
bun run electron:dev       # Vite + Electron 热重载（端口 5175 起自增）
bun run build              # 生产构建（TS + Vite）
bun run lint               # oxlint，含 theme:check / theme:audit
bun run format             # oxfmt；提交前 bun run format:check
bun run test               # Vitest；bun run test -- <name> 过滤
bun run compile:electron   # 仅主进程
bun run dist:mac|dist:win|dist:linux
bun run theme:generate     # 改 token/recipe/生成器后必跑
bun run rebuild:electron-native   # 原生模块依赖变更后
```

Node >=24 <25，Bun >=1.3。包管理与脚本一律用 Bun（`bun install`、`bun run <script>`、`bun.lock`），不使用 npm。Windows 构建需 PortableGit（见 README.md）。

## 产品与品牌

知远智能体 (ZhiYuan Agent)：Electron + React 本地优先 AI Agent 桌面应用（Cowork 会话、本地推理、Skills/MCP、Artifacts 预览）。

- 对外文案只用「知远智能体 (ZhiYuan Agent)」，旧名不得复活。Pi、cc-connect、llama.cpp 是内部细节，不得出现在用户可见文案；对外称全栈自研。
- **焦土政策**：旧标识、旧运行时、旧库文件不做迁移、兼容层、读取、启动、打包或回退；旧数据原地弃置，不主动删除。不做用户未要求的向后兼容。

## 架构

### 进程

- **Main**（`src/main/main.ts`）：窗口、SQLite（better-sqlite3，`sqliteStore.ts`，库文件 userData/`zhiyuan.sqlite`）、Pi 运行时、llama.cpp 生命周期（`libs/llamacppManager.ts`、`src/shared/llamacpp/`）、Skill 管理（`skillManager.ts`）、MCP、IPC handler。安全：contextIsolation 开、nodeIntegration 关、sandbox 开。
- **Channel/Cron 传输**（`src/main/libs/ccConnect*`、`src/main/im/`）：只搬运事件与 cron 触发，不执行 Agent、不持有任务状态。对外渠道：微信、企业微信、钉钉、飞书/Lark、QQ、Email；旧 connector 不得在 UI/文档重新暴露。
- **Preload**（`src/main/preload.ts`）：`window.electron`，含 `cowork` 命名空间。
- **Renderer**（`src/renderer/`）：全部 UI 与业务逻辑，只经 IPC 访问主进程；非 UI 逻辑放 `src/renderer/services/`。

### 主进程 / Worker 边界

主进程必须保持响应：请求/IPC/agent 流路径上禁止同步递归扫盘、整文件读/哈希、大 JSON/Markdown 解析、重正则、压缩等 CPU 密集工作，放 `worker_threads`：

- Worker 要求：入出参可序列化、隔离可变状态、有界池 ≤2、可取消、限输入/队列、结构化错误、尽量传 ArrayBuffer。主进程负责校验路径与结果、执行写操作、维护用户可见状态，并记录新任务排队/运行耗时。
- 永不进 Worker：Electron API、SQLite 连接/事务、agent 会话生命周期、工具审批、流排序、密钥、renderer/DOM。
- **Touch-to-refactor**：改动含阻塞扫描/哈希/解析/转换的组件（Skill 安全扫描、artifact 收集哈希、备份快照哈希、模型目录扫描、大 artifact 解析等）时，同 PR 抽到 Worker，附边界测试与前后耗时/事件循环延迟证据；不可分离的部分在 PR 说明保留边界。

### Cowork 与数据流

- `App.tsx` → `coworkService.init()` → IPC 加载配置/会话 → 流监听；`startSession()` → IPC → `PiRuntimeAdapter` → 流事件 → Redux。
- 流事件：`message` / `messageUpdate` / `permissionRequest` / `complete` / `error`。权限请求经 `CoworkPermissionModal` 回传引擎。
- IPC：`cowork:startSession`、`continueSession`、`stopSession`、`getSession`、`listSessions`、`deleteSession`、`respondToPermission`、`getConfig`、`setConfig`。`cowork:stream:*` 承载 Work/Chat；Channel/Cron run 以只读 activity 投影暴露。
- 执行模式 `CoworkExecutionMode`：`auto` / `local`。
- 存储：`cowork_sessions` / `cowork_messages`；应用配置在 `kv`；Cowork 配置在 `cowork_config`；Task/Run/Delivery/ChannelAccount/ChannelSession 以 ZhiYuan SQLite 为准。
- 认证：deep-link `authCode` 换 2h access + 30d refresh token（`auth_tokens`）；`fetchWithAuth()` 在 401 或剩余 <5 分钟时刷新并轮换。见 `src/renderer/services/api.ts`。

### 托管 Python 运行时

首启同步到 `userData/runtimes/`，两层：

- `resources/python-win|mac|linux`：便携 CPython（uv 管理），agent shell PATH 基础解释器，`UV_PYTHON` 绑定。
- `resources/skill-python/layers/shared`：合并所有内置 Skill requirements 的单个 uv venv，经 `applyManagedPythonEnv`（`src/main/libs/managedPythonEnv.ts`）前置到 PATH。Windows 需 `python3.exe` 别名（安装脚本创建，`ensureSharedSkillWindowsPython3Alias` 自愈）。`run_skill_script` 经 `findSkillPythonExecutable` 解析并强制 per-Skill `requirementsSha256` manifest 门。
- **模型面策略三处必须同步**：`SYSTEM_PROMPT.md`（托管环境与工具节）、`piPythonEnvGuidelines.ts`（`python-runtime` contribution，用户覆盖系统提示后仍生效）、`piBashToolGuidelines.ts` 的 `getPiBashPythonEnvViolation`（拦截向托管解释器 pip install、直接 `python` 调内置 Skill 脚本）。

### 记忆系统

本地 Engram（`vendor/engram-runtime`）+ SQLite 投影表 `memory_links` / `memory_candidates` / `memory_outbox`。

- 作用域：`project`（id = `workspace-` + sha256(cwd)，见 `src/main/workspaceUtils.ts`、`src/shared/memory/constants.ts`）；`personal`（`personal://zhiyuan-agent/user`，写入进候选队列，用户确认后生效）；`session`（摘要，30 天 TTL）。
- 写入：Work 模式 `memory` 工具（`src/main/memory/piMemoryTool.ts`）先经 `AtomicMemoryExtractor`；每轮后 `runPostTurnMemoryMaintenance`。
- 注入：每轮前 `buildProjectMemoryContextSafe`，预算 project/personal/session = 900/250/350 token。Chat 不用记忆；IM/Cron 同 Work。旧 `MEMORY.md` 只在启动时导入为候选，永不注入 prompt。

### 其他

- **Artifacts**：HTML/React 跑隔离 iframe，SVG 经 DOMPurify，Mermaid 严格安全模式——改渲染器不得破坏这些边界。
- **TS**：`tsconfig.json`（renderer）、`electron-tsconfig.json`（主进程，CommonJS → `dist-electron/`）；别名 `@` → `src/renderer/`。
- **Skills**：`SKILLs/` 是 Pi 运行时的内置 skill（经 `skills.config.json`），不是 IDE/agent 插件 skill。
- **llama.cpp**：服务级选项管 `llama-server` 进程，模型级选项在加载/运行时传入。

## 前端设计规则（P0）

适用于全部前端工作，不因改动小、赶时间、委派或使用组件库豁免。

### 事实来源与优先级

- 视觉规范唯一来源是 [DESIGN.md](DESIGN.md)，具体数值只在那里维护。优先级：AGENTS.md / DESIGN.md > 项目 UI skills（`frontend-ui-change-strategy`、`rongxinai-ui-adapter`）> `design-taste-frontend` > `high-end-visual-design` > 组件库默认、历史代码、个人审美。规范间有实质冲突时指出冲突点，不得自选较宽松的一方。
- 改 UI 前必须读 DESIGN.md 相关章节、受影响组件及其 token/recipe，并看下方范例。「原来就是这么写的」不是理由。
- 「美化/优化/现代化」不是自由发挥许可。禁止擅自新增色系、字号/圆角/阴影档、装饰光晕、动画、嵌套卡片、Hero、导航层级或虚构状态。
- 新视觉语义：先更新 DESIGN.md 与契约，再实现全部主题；禁止先实现再改规范背书。
- 偏离已批准设计须取得用户明确授权（本轮已授权的不重复问），写入 DESIGN.md 并在 PR 列出。其他 agent 同意或工具默认不算授权。
- 禁止绕过验收：不删弱检查项、不关审计、不扩白名单、不加无依据例外、不未经用户验收覆盖基准截图。

### 已验收范例：2026-10-05 主界面

后续产品界面必须继承此版理念，不得退回早期风格。基准截图（1280×800）：[浅色](docs/theme-previews/main-interface-2026-10-05-light.png)、[深色](docs/theme-previews/main-interface-2026-10-05-dark.png)；新基准须经用户验收并记录日期与理由。

| 特征 | 做法 | 入口 |
| --- | --- | --- |
| 侧栏分组清楚、主动作突出 | 模式/新建/功能/项目历史分层，靠留白与文字角色区分；新建用共享主按钮 | [SidebarNavigationView.tsx](src/renderer/components/shell/SidebarNavigationView.tsx)、[shell-sidebar.ts](src/renderer/theme/components/shell-sidebar.ts) |
| 主输入区是视觉中心 | 正式字标、克制说明、居中输入岛；工具入口就近，无装饰光晕 | [CoworkView.tsx](src/renderer/components/cowork/CoworkView.tsx)、[classic-message-surfaces.ts](src/renderer/theme/components/classic-message-surfaces.ts) |
| 控件规格一致 | 复用 ai-elements 输入与共享选择器；窄窗口下文件夹/权限/模型/提交仍可达 | [CoworkPromptInput.tsx](src/renderer/components/cowork/CoworkPromptInput.tsx)、[PromptWorkspaceSelector.tsx](src/renderer/components/cowork/PromptWorkspaceSelector.tsx)、[PromptSelectorButton.tsx](src/renderer/components/cowork/PromptSelectorButton.tsx) |
| 引导项轻量中性 | 共享按钮 + Lucide 图标，胶囊对应真实任务，不做彩色装饰卡 | [QuickActionBar.tsx](src/renderer/components/quick-actions/QuickActionBar.tsx)、[classic-page-controls.ts](src/renderer/theme/components/classic-page-controls.ts) |
| 明暗成套、外观与行为分离 | token + 注册 hook + recipe；切主题原位更新，保留输入与交互状态 | [home-studio.ts](src/renderer/theme/components/home-studio.ts)、[home-studio-contract.ts](src/renderer/theme/components/home-studio-contract.ts)、[classic-light.ts](src/renderer/theme/themes/classic-light.ts)、[classic-dark.ts](src/renderer/theme/themes/classic-dark.ts) |

范例确立的是克制层级、统一控件、主题归属与状态连续性。设置页、列表页用 DESIGN.md 对应范式，不复制首页 Hero；引用文件中的遗留代码不因此豁免。

### 组件

先查再写，禁止自造轮子。用户只能选整套主题 + 浅色/深色/跟随系统，不加其他独立样式设置。

- **shadcn/ui**（`src/shared/components/ui/`）：页面 tab 只用 `PageTabs`（放 PageHeader tabs 槽），分段/筛选只用 `FluidTabs`，删除确认只用 `DestructiveConfirmDialog`。
- **ai-elements**（`src/shared/components/ai-elements/`）：聊天/推理/工具/附件/代码等展示必须用它。
- 图标只用 `lucide-react`，禁止手写 SVG 图标组件。
- 页面顶栏只用 `src/renderer/components/PageHeader.tsx`；标题只在 PageHeader 出现一次，内容区不重复。
- Button 的 className 只许布局类（`w-full`、`justify-start`、`gap-*`），外观走 variant/size。行级可点区域不用裸 `div onClick`（见 DESIGN.md「Button 使用纪律」）。
- 结构组合用 Tailwind `className` + `cn()`（`@shared/lib/utils`）。Tailwind v4，无 `tailwind.config.js`；优先 shorthand variant（`data-active:` 而非 `data-[active]:`）。

### 主题系统

主题包是仓库内注册的展示数据，不是插件或用户 CSS。详见 `src/renderer/theme/README.md`。

- 入口：`themes/plugins.ts`（注册；每套主题必须提供完整 light/dark）、`themes/types.ts`（`ThemeDefinition`）、`tokens/contract.ts`、`components/contract.ts`（hook/状态/属性白名单）、`theme/components/`（控件 recipe）、`engine/` + `components/css.ts`（生成与原位应用）。
- `css/themes.css` 只由 `bun run theme:generate` 生成，禁止手改或全局覆盖。
- **布局归组件**（DOM、排列、滚动、命中区、键盘、焦点、禁用语义、父容器填充、flex 收缩）；**外观归 recipe**（控件自身尺寸、内边距、字体、边框、圆角、阴影、透明度、状态动效）。禁止在页面/包装组件/原生控件/运行时 DOM 写局部颜色、圆角、阴影、字号、尺寸或状态样式；语义色 utility 也不得绕过 recipe。
- 改外观先找现有 recipe；新语义先扩共享 variant/size 或注册 hook，再补齐所有主题。
- 每个 hook 声明 `COMPONENT_STATES` 全部状态（无独立视觉用 `recipe()` 补空对象）。主题只能填白名单属性，禁止任意选择器、脚本、事件、IPC、CSS 注入、未登记变量。稳定 hook 不依赖会被包装层替换的 `data-slot`；第三方样式优先级只在引擎固定集成点处理，禁止提权重或 `!important`。
- 切主题不得改 React key、重建编辑器、清草稿，不改变焦点、滚动、选中、弹层、事件和持久化；动效遵守 `prefers-reduced-motion`。
- 背景由主题包提供，不新增用户侧设置、存储键或覆盖入口。

### 前端工作流程

1. **改前**：列出涉及的 DESIGN.md 章节、复用组件、token/recipe 入口、受影响页面/状态。
2. **委派**：传递规范、范例与验收条件；委派方负责最终逐项验收，不只接受「已完成」。
3. **改后**：逐项完成 DESIGN.md「十、落地检查清单」，每项标「通过 / 不适用（理由）/ 未通过（问题）」，未通过继续修。
4. **实际渲染**（`bun run electron:dev`）：light/dark；适用状态（hover/pressed/selected/disabled/invalid/open）；键盘焦点；窄窗口、长文本、动态内容、portal；reduced-motion；用改了 recipe 的主题热切换，确认新值生效且草稿/焦点/选中/弹层/滚动保留；检查实际尺寸与溢出。
5. **自查要点**：视觉中心与主动作是否清楚、分组是否靠留白与字阶；是否新增多余颜色/边框/阴影/动效/卡片层/重复标题；是否有调用点绕过 recipe 或只适配单一主题。

截图、测试、lint 各证明不同事项，互不替代；自动检查不覆盖设计判断。纯文档改动只做一致性与链接检查，不宣称 UI 验收。

## 编码规范

- TypeScript，函数组件 + Hooks；2 空格、单引号、分号。组件 `PascalCase`，函数/变量 `camelCase`，Redux slice `*Slice.ts`。
- 禁止 `any`（确需时旁注理由）。第三方 API/类型先查 `node_modules` 实际声明。
- 禁止内联 `await import()`，一律顶层 import。
- 文件：新文件目标 ≤800 行、硬上限 1000 行。已有超长文件不再追加，新逻辑写新文件 import；不主动拆旧文件，除非用户要求。
- 大范围改动前完整读相关文件，不凭搜索片段判断。
- 删除看似有意为之的功能/代码前先问用户。
- 过期依赖的类型错误靠升级依赖解决，不降级或删代码绕过。
- 临时脚本写临时文件执行、用完删除；不在 bash 命令里嵌多行脚本。

### 字符串常量

判别值、状态码、IPC channel、模式选择器等多处比较的字符串禁止裸字面量，每模块一个 `constants.ts`（范例 `src/scheduledTask/constants.ts`）：

```typescript
export const SessionTarget = { Main: 'main', Isolated: 'isolated' } as const;
export type SessionTarget = (typeof SessionTarget)[keyof typeof SessionTarget];
```

- 构造、比较、测试都用常量（`SessionTarget.Main`）；接口判别字段保持字面量定义联合形状（`kind: 'at'`），常量值与之对齐。
- 所有 `ipcMain.handle()` / `ipcRenderer.invoke()` 必须引用 `IpcChannel` 常量。
- 豁免：外部透传平台标识（`'feishu'`）、单点一次性字符串（错误消息、log tag）、Tailwind/React UI 字符串。

### 日志

`src/main/logger.ts`（electron-log）接管主进程 `console.*`，直接用 console，禁止另引日志库。

- `error` 不可恢复；`warn` 可恢复/降级；`log` 关键生命周期（服务启停、连接、会话创建销毁、配置变更）；`debug` 调试细节。
- 格式：`[ModuleName]` + 纯英文自然语句（`received 5 messages`，不写 `historyMessages: 5`）；一行一事；error/warn 带可追踪 ID；error 对象作最后参数：`console.error('[Module] operation failed:', error)`。
- 高频路径（轮询、心跳、同步循环）禁止逐 tick info 日志；不写函数入口日志。

### i18n

用户可见字符串一律走 `t()`：renderer 用 `src/renderer/services/i18n.ts`，主进程（托盘、会话标题、通知）用 `src/main/i18n.ts`。新键 zh/en 齐全，不确定先留 `// TODO: translate`。仅 DevTools/日志可见的信息豁免。

### 依赖

只在必要时新增，先确认仓库内无现成能力；精确锁版本，用 `bun install`；`bun.lock` 变更视同代码评审。含原生模块（better-sqlite3、node-pty）的变更后跑 `bun run rebuild:electron-native`。

## 测试与验证

- 代码改动后跑 `bun run lint` 并清零警告；提交前 `bun run format:check`。
- 改 token/recipe/生成器：`bun run theme:generate`。改共享契约/主题引擎：另跑 `bunx vitest run src/renderer src/shared`、`bun run build`、`bun run test:bundle-budget`。
- 单测与源码同目录，只用 `.test.ts`，`import { test, expect } from 'vitest'`；避免 import Electron-only API（如 electron-log）。新建/修改的测试必须跑到通过。
- 全量测试有少量环境相关存量失败（skill smoke、release manifest 等）。遇失败用 `git stash` 对照 HEAD 判断是否由你引入。
- **Provider 回放**：`tests/piLongTaskReplay.test.ts` 用录制磁带（`tests/replay/tapes/longtask-32doc.jsonl.gz`）对完整 Pi adapter 栈跑 32 文档长任务，做严格 seq+hash 匹配，prompt 组装、工具接线或完成语义漂移即失败。prompt/场景有意变更后重录：`AB_LONGTASK=record AB_LONGTASK_UPSTREAM_API_KEY=<token> npx vitest run tests/abLongTask.harness.test.ts`（live 上游与模型见 `tests/replay/piLongTaskScenario.ts`；2026-10 起算力为 64K 上下文单模型部署，场景规模据此定为 32 文档）。
- UI 改动在 `bun run electron:dev` 验证关键流程：Cowork（发 prompt、批准/拒绝权限、停止）、Artifacts（HTML/SVG/Mermaid/React）、Settings（主题/语言切换）；console 无新增警告/错误。

## Git 与 PR

本仓库可能有多个 agent 会话并行，工作区改动混杂：

- 只提交本会话改的文件：`git add <显式路径>`，禁止 `git add -A` / `.`；提交前 `git status` 核对。
- 禁止 `git reset --hard`、`git checkout .`、`git clean -fd`、`git commit --no-verify`、`git push --force`。
- `git stash` 必带 `-m` 并在本会话尽快 pop。冲突只解自己改过的文件，否则中止问用户。
- 评审 PR 用 `gh pr view` / `gh pr diff` / `gh api`，不 checkout 他人分支。审查等对方声明完成后再做，或约定不重叠文件域；边写边审须标注审查时点。
- 报缺陷前对照 HEAD 验证根因；不确定按「疑似」上报。

**提交**：Conventional Commits，全英文 `type(scope): summary`。type ∈ `feat|fix|refactor|chore|docs|test|perf|style|ci|build|revert`；subject 小写祈使、≤72 字符、无句号；body 写 why；破坏性变更加 `!` 与 `BREAKING CHANGE:` footer；关联 issue 每个都写关键词（`closes #1, closes #2`）。不用 emoji、不写客套话。

**PR**：标题与三段说明遵循 [DEVOPS.md](DEVOPS.md)：改动、原因、验证；bug fix 补充触发条件、原行为、根因与修复后行为。有 issue 时关联，不强制为小修复新建 issue。所有 PR（含文档）需非作者的一次正式 GitHub approval，新提交使旧 approval 失效；不按作者姓名指定特殊评审人。说明适用的 Electron 行为变化（IPC、存储、窗口）。UI 变更必须附设计自查：规范依据、主题与窗口尺寸、已验证状态/操作、明暗截图位置、命令结果、获准偏离、未验证项。禁止只写「符合设计」「已自测」；环境阻塞如实列出，不标通过。有未通过的设计项或缺必要验收时不得建议合并。

**CI**：统一必需检查 `ci-gate` 校验 PR 元数据，并汇总当前提交适用的现有流水线；`.github/devops-ci.json` 与触发范围同步。`.github/workflows/ci.yml` 的基线（lint / test / bundle-budget）永远运行；重型检查（linux-install、windows-install、memory-leak）由 `scripts/ci/gates/plan.ts` + `policy.ts` 按 PR diff 路径选择；`merge-gate`（`scripts/ci/gates/verify.ts`）继续汇总本仓应用检查。独立 approval 由服务端分支规则统一强制，管理员可通过 PR 绕过 review，其余角色不允许；CI、禁止强推和删除仍适用管理员，合并前解决评审讨论。发布流水线（daily-release、release-candidate、online-update-* 等）独立于 PR 门禁。

**项目管理**：使用 [知远数字员工平台](https://github.com/orgs/rongxinzy/projects/2)，主要协作团队为 opensource。需求、缺陷与交付事项加入 Project，复用 Assignees 记录实际负责人，并维护 Status、Priority；Target date 仅填写承诺日期。PR 加入同一 Project，有关联 Issue 时互链；合并完成不代替部署或业务验收。不另建重复台账。

## 协作

- 回答简洁直接；用户提问先回答，再动手。
- 回应评审先明确同意/不同意，再说改了什么。
- 解释非平凡设计按「问题 → 例子 → 方案 → 为何必须」，区分必要与可选复杂度。

## 外部 Skills

- 产品界面（Work/Chat/Settings/MCP/Skills/本地推理等）以 DESIGN.md + 共享组件 + `rongxinai-ui-adapter` 为准，不套营销页默认。landing/营销/品牌页用 `design-taste-frontend`；明确需要高级视觉或复杂动效才读 `high-end-visual-design`。可选 `shadcn/ui`、`vercel/ai-elements`、impeccable（`npx impeccable install`，`/impeccable`）。
- 任何 skill 只补充本文件，不能取消设计自查或绕过已验收基准。

## 跨仓协作规范

提交、PR 标题与说明、review、bug fix 验证遵循 [DEVOPS.md](DEVOPS.md)。本仓已有专项安全、设计与发布门继续执行。
