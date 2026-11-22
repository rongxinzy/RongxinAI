# AGENTS.md

本仓库编码 agent 指南。CLAUDE.md 是本文件的软链接。用户指令与本文件冲突时，先请求明确确认再执行。

## 核心原则

1. **Pi First。** `src/main/libs/agentEngine/piRuntimeAdapter.ts` 是唯一执行内核（Work/Chat/Channel/Cron 全走它）。新能力优先用 Pi 原生机制，不在 harness 层重造。
2. **Harness 不得劣化 Pi。** 提示注入、工具包装、闸门、拦截、强制纠偏等不得浪费 token、制造模型摩擦或扭曲行为基线；被证明劣化的机制直接移除，不加固。反例：强制模型先调 `set_task_output` 声明交付物（#786 引入、#917 移除），不得重新引入。
3. **设计合规是前端 P0 门禁。** 见下文「前端设计规则」。设计违规即阻断缺陷，功能可用或测试通过不能抵消。

## Ponytail

编码、修复、重构、评审和依赖选型默认采用 `full`。用户可在对话中用 `/ponytail` 的写法切换等级或按下文停用。Ponytail 与本文件的其他规则或引用规范冲突时，以 Ponytail 为准。 [Ponytail 原文（MIT）](https://github.com/DietrichGebert/ponytail/blob/df9e89941d50419fd5bcf1de41e28097f1db49b2/skills/ponytail/SKILL.md)

You are a lazy senior developer. The best code is the code never written. You solve the whole problem with the least new code. End your reply with one or two lines: what you skipped or did not check, and any risk the user must know.

Active for the whole session until the user says "stop ponytail" or "normal mode". Switch level: `/ponytail lite|full|ultra`.

### Before you write

Read the task and the code it touches. List every place your change must reach: callers, tests, fixtures, config, exports. Check what your change could break for users: data it would destroy or expose, callers that stop working. That is scope. Extra features are not.

### The smallest complete change

Take the first option that fully works:

1. Does it need to exist? Skip features, options and flexibility nobody asked for, and name them in one line. A vague request ("build me X") gets the smallest version that does the core job.
2. Already in this codebase (a helper, component, service, pattern)? Use it the way the surrounding code does.
3. Standard library or a platform feature? Use it, unless the project has its own. A house component beats a native widget.
4. An installed dependency? Use it. Never add a dependency for a few lines.
5. Can it be one line a reader gets at a glance? One line.
6. Otherwise: the minimum code that works.

- Be lazy about the solution, never about the change itself: finish every part the task needs, including the callers, tests and fixtures your change breaks.
- No abstraction, wrapper, type conversion, option, config, boilerplate or "for later" code nobody asked for. Keep values in the form the platform already gives you. Deletion beats addition. Keep the structure the codebase already has: its layers, interfaces and conventions.
- The shortest working diff wins, once you know everything it must touch. A one-liner that needs decoding is not short.
- Comment only the why the code cannot show, in one line.
- Bug fix: before you edit, grep every caller of the function you touch, then fix the root cause once in the shared code.
- Code you move or merge keeps its error handling and validation.
- Between options of equal size, take the one that is correct on edge cases.
- Lazy code without its check is unfinished: new non-trivial logic (a branch, a loop, a parser, money or security, or a whole new script or app) leaves one small test or an assert-based self-check. Trivial changes need none.
- A shortcut with a known limit gets a code comment in this form: `shortcut: <the limit>, <when to upgrade>`.

Never cut: validation at trust boundaries, error handling that prevents data loss, security, accessibility, the calibration real hardware needs, anything the user asked for.

### Levels

| Level | Behavior |
|-------|----------|
| **lite** | Build what was asked. Name the smaller option in one line and let the user pick. |
| **full** | The rules above. Default. |
| **ultra** | Also question the request: before building, push back on any part the need does not justify. |

<!--
MIT License

Copyright (c) 2026 DietrichGebert

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
-->

## 命令

```bash
bun run electron:dev       # Vite + Electron 热重载（端口 5175 起自增）
bun run web:preview        # 浏览器预览（端口 5176，无需 Electron）
bun run web:preview:check  # 浅色/深色走查主要界面，console error 即失败
bun run preview:doc-screenshots  # 1280×800 文档截图到 docs/theme-previews/
bun run build              # 生产构建（TS + Vite）
bun run lint               # oxlint，含 theme:check / theme:audit
bun run format             # oxfmt
bun run test               # Vitest；bun run test -- <name> 过滤
bun run test:unit          # 日常单测，无应用构建或 Electron 原生重编译
bun run test:full          # 发版前完整测试，包含真实 Electron ABI 夹具
bun run compile:electron   # 仅主进程
bun run dist:mac|dist:win|dist:linux
bun run theme:generate     # 改 token/recipe/生成器后必跑
bun run rebuild:electron-native   # 原生模块依赖变更后
```

### 浏览器预览模式

改渲染器 UI 时，用浏览器预览代替 Electron 做调试。`bun run web:preview` 在端口 5176 启动 Vite；`bun run web:preview:check` 会自己拉起 preview，用浅色和深色走查主要界面。

- 仅在 `import.meta.env.DEV` 且没有 preload bridge 时，`main.tsx` 才动态加载 `src/renderer/browserMock/`。生产构建不含 mock。
- 完整表面由 `scripts/preview/generate-browser-mock.ts` 按 `Window['electron']`（`src/renderer/types/electron.d.ts`）生成。没有单独实现的方法返回类型上合法的默认值，每个路径只 `console.warn` 一次，不抛异常。`on*` 订阅注册到进程内事件总线，fixture 用同一条总线回放流式事件。
- 会话、流式回复、设置、Skills、MCP、自动化、本地推理和 IM 的数据在 `browserMock/interactive.ts` 与 `browserMock/fixtures/`。改了 preload 契约后跑 `bun run web:preview:codegen`，并提交 `src/renderer/browserMock/generated/`。`bun run web:preview:codegen:check` 会在生成结果过期时失败。
- `bun run web:preview:check`（先 `bunx playwright install chromium`）在 headless Chromium 中跑 Playwright 交互测试与 warn-only 的 axe 抽检；mock 仍支持 URL 参数 `previewScenario` / `previewEdition` / `previewSkipBoot` 供本地走查。`console.error` 与 `pageerror` 会让检查失败。Preload 契约：`bun run web:preview:contract`；生成面校验：`bun run web:preview:codegen:check`。这些检查由发布前 `release-preflight.yml` 的 `browser-preview` job 统一执行，日常 PR 不自动启动浏览器。

Node >=24 <25，Bun >=1.4 <1.5（与 `package.json` 的 `packageManager` 一致）。包管理与脚本一律用 Bun（`bun install`、`bun run <script>`、`bun.lock`），不使用 npm。Windows 构建需 PortableGit（见 README.md）。桌面壳 Electron **44.x**；Agent 执行栈 `@earendil-works/pi-*` **1.5.2**，带原生 fork 修复（见 `package.json`、[上下文压力修复](docs/architecture/pi-context-pressure-fork.zh-CN.md)）。

## 产品与品牌

知远智能体 (ZhiYuan Agent)：Electron + React 本地优先 AI Agent 桌面应用（Cowork 会话、本地推理、Skills/MCP、Artifacts 预览）。

- 对外文案只用「知远智能体 (ZhiYuan Agent)」，旧名不得复活。Pi、cc-connect、llama.cpp 是内部细节，不得出现在用户可见文案；对外称全栈自研。
- **焦土政策**：旧标识、旧运行时、旧库文件不做迁移、兼容层、读取、启动、打包或回退；旧数据原地弃置，不主动删除。不做用户未要求的向后兼容。

## 架构

目录导览、Pi/llama.cpp 模块拆分、IPC 约定与发版摘要见 [docs/architecture/overview.zh-CN.md](docs/architecture/overview.zh-CN.md)。Cowork **流式**细节见 [docs/architecture/streaming.md](docs/architecture/streaming.md)：全链路增量 UIMessageChunk（translator → 16ms coalescer 单点合并 → 序列化 IPC → rAF 批处理 → LiveTextStore），全文快照仅限非前缀改写/2M 截断/断档重同步/终态。

### 进程

- **Main**（`src/main/main.ts`）：窗口、SQLite（better-sqlite3，`sqliteStore.ts`，库文件 userData/`zhiyuan.sqlite`）、Pi 运行时、llama.cpp 生命周期（`libs/llamacppManager/`、`libs/llamacppBackendManager/`、`ipcHandlers/llamacpp/`；对外仍经同名 barrel，`src/shared/llamacpp/` 共享类型）、Skill 管理（`skillManager.ts`）、MCP、IPC handler。安全：contextIsolation 开、nodeIntegration 关、sandbox 开。
- **Channel/Cron 传输**（`src/main/libs/ccConnect*`、`src/main/im/`）：只搬运事件与 cron 触发，不执行 Agent、不持有任务状态。对外渠道：微信、企业微信、钉钉、飞书/Lark、QQ、Email；旧 connector 不得在 UI/文档重新暴露。
- **Preload**（`src/main/preload.ts`）：`window.electron`，含 `cowork` 命名空间。
- **Renderer**（`src/renderer/`）：全部 UI 与业务逻辑，只经 IPC 访问主进程；非 UI 逻辑放 `src/renderer/services/`。

### 渲染层 IPC 与状态

- **Toast：** 全局提示只经 `showAppToast` / `showAppError`（`src/renderer/services/toastNotification.ts`、`appToast.ts`）派发；禁止直接 `CustomEvent('app:showToast')`。`bun run lint` 含 `scripts/ci/check-app-show-toast-dispatch.mjs`。
- **持久化 vs Redux：** `src/renderer/services/store.ts` 是主进程 SQLite KV 的 IPC 适配器；Redux 在 `src/renderer/store/`，二者勿混。

### 主进程 / Worker 边界

主进程必须保持响应：请求/IPC/agent 流路径上禁止同步递归扫盘、整文件读/哈希、大 JSON/Markdown 解析、重正则、压缩等 CPU 密集工作，放 `worker_threads`：

- Worker 要求：入出参可序列化、隔离可变状态、有界池 ≤2、可取消、限输入/队列、结构化错误、尽量传 ArrayBuffer。主进程负责校验路径与结果、执行写操作、维护用户可见状态，并记录新任务排队/运行耗时。
- 永不进 Worker：Electron API、SQLite 连接/事务、agent 会话生命周期、工具审批、流排序、密钥、renderer/DOM。

### Cowork 与数据流

- **流式链路**：改动 translator / coalescer / `piUiForwarder` / `LiveTextStore` / `StreamingMarkdownResponse` / 相关 IPC 前，必须先读 [docs/architecture/streaming.md](docs/architecture/streaming.md)。禁止发送端拼全文再 diff、禁止第二层发送端节流、禁止 IPC 常规推送全文快照；守护测试见 `tests/streamingGuards.test.ts`。
- `App.tsx` → `coworkService.init()` → IPC 加载配置/会话 → 流监听；`startSession()` → IPC → `PiRuntimeAdapter` → 流事件 → Redux。
- 流式 IPC/渲染细节不在此维护，见 [docs/architecture/streaming.md](docs/architecture/streaming.md)（Pi 事件翻译为增量 UIMessageChunk，主进程仅 coalescer 一处合并，终态才落 Redux，快照只走异常路径）。
- 流事件：`CoworkStreamIpc`（`src/shared/ipc/channels.ts`）——`cowork:stream:runState` / `contentPatch` / `runtimeSnapshots` / `uiEvent` / `resync`。权限请求经 `CoworkPermissionModal` 回传引擎。
- IPC（通道常量在 `src/shared/ipc/channels.ts`，契约在 `src/shared/ipc/coworkContract.ts`）：`cowork:session:start` / `continue` / `stop` / `get` / `list` / `delete`、`cowork:permission:respond`、`cowork:config:get` / `set`。`cowork:stream:*` 承载 Work/Chat；Channel/Cron run 以只读 activity 投影暴露。
- 执行模式 `CoworkExecutionMode`：`auto` / `local`。
- 存储：`cowork_sessions` / `cowork_messages`；应用配置在 `kv`；Cowork 配置在 `cowork_config`；Task/Run/Delivery/ChannelAccount/ChannelSession 以 ZhiYuan SQLite 为准。
- 认证：社区账号登录在主进程 `src/main/appBootstrap/communityAuth.ts` 与 `src/main/communityAuthSession.ts`，deep-link `zhiyuan://auth/callback` 换取 access/refresh token，剩余 <5 分钟时刷新；未登录时为免费模型签发访客 token。

### 托管 Python 运行时

- **独立工作区 Python 运行时**（`src/main/pythonRuntime/`）：独立子进程 `dist-electron/python-runtime-runner.js`（`runner.ts`）使用随包 CPython + `uv`，按规范化工作区路径哈希管理 `userData/python-runtime/workspaces-v2/<sha256>/` 的版本化 `venv` 与原子切换的 `current.json`。首次离线复制内置办公/PDF 依赖基线，后续安装从当前环境复制独立候选；不使用硬链接共享可写包，不读取旧 `workspaces/`。`python_execute` / `python_install` 接受代码或包名/版本范围，解析锁定后检查依赖，失败保留原环境；安装仅接受兼容 wheel。POSIX 由独立 supervisor 监视 Runner 并清理进程组，Windows 用 `resources/python-runtime/job-runner.exe`（`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`）。
- **内置 Skill 与工作区共用 Python 链路**：`resources/python-win|mac|linux` 与 `resources/skill-python/layers/shared` 为随包基线，首启同步到 `userData/runtimes/`，shell 由 `applyManagedPythonEnv` 注入其核心库；Python `run_skill_script` 经 `PythonRuntimeService.execute/prepare` 使用与 `python_execute` 相同的工作区环境，包装脚本与长驻进程先 prepare。Runner 强制核对 per-Skill `requirementsSha256`；v3 按需依赖同时校验 `locks/` 内 delta lock 的 SHA-256，大下载保留确认门，缺失/过期 manifest 直接失败，不走 `uv run` 回退。工作区与 Skill 安装共用索引默认值和 uv 缓存。
- **模型面策略三处必须同步**：`SYSTEM_PROMPT.md`（托管环境与工具节）、`piPythonEnvGuidelines.ts`（`python-runtime` contribution，用户覆盖系统提示后仍生效）、`piBashToolGuidelines.ts` 的 `getPiBashPythonEnvViolation`（拦截在 bash 中直接用 `python` 调内置 `$SKILLS_ROOT` 脚本，引导改用 `run_skill_script`）。

### 记忆系统

本地 Engram（`vendor/engram-runtime`）+ SQLite 投影表 `memory_links` / `memory_candidates` / `memory_outbox`。业务检查点、同步状态、原生会话身份与关闭意图分别存于 `memory_checkpoints` / `memory_runtime_sessions` / `memory_session_finalizations`。

- 作用域：`project`（id = `workspace-` + sha256(cwd)，见 `src/main/workspaceUtils.ts`、`src/shared/memory/constants.ts`）；`personal`（`personal://zhiyuan-agent/user`，写入进候选队列，用户确认后生效）；`session`（摘要，30 天 TTL）。
- 写入：显式 `memory` 工具保存走确定性的 `prepareExplicitUserRequestedMemory`（`src/main/memory/piMemoryTool.ts`，无额外 LLM 抽取）；会话检查点由 agent 通过 `session_summary` 工具（`src/main/sessionSummary/tool.ts`）在当前上下文中自写，经 `sessionCheckpointService.ts` 将不可变正文与 outbox 原子落 SQLite，再同步 Engram。不再按回合做窗口抽取（`runPostTurnMemoryMaintenance` 已退役）。新检查点使用独立 `session/<sessionId>/checkpoint/<checkpointId>` topic 保留可召回历史，本地最新检查点表示当前状态；旧滚动 topic 只兼容既有记录。
- 身份与生命周期：工具执行时读取当前 run/turn 和产物工作版本，以 write/edit 完成时的实际 mtime 区分最终扫描与脚本对同一路径的后续修改，避免重复计数或漏算；written/skip 只覆盖当时的工作量，新回合或后续新增、修改产物会重新激活摘要义务。`memory_runtime_sessions` 保存全部 Engram effective/continuation ID 的历史归属，并另存当前写入指针；恢复旧 observation 只补历史、不回退指针，不自行拼接 ID。单删与批删在同一个共享 SQLite 事务中写关闭意图、finalize outbox 并删除会话；原生 finalize 必须等待同会话旧写入确认，并在投递时跟随实际 current effective ID，不能在关闭后自动续接。Completed 仅表示旧生命周期已关闭；恢复后有新写入时必须保留旧结果并创建新关闭意图，不能因旧 Completed 而跳过。finalize outbox 只按对应生命周期的 intent link 复用，禁止跨生命周期复用或改写历史结果。
- 收尾义务：有文件产出的回合未写检查点时，不自动续跑模型或注入纠正提醒，只记录遗漏指标并以确定性兜底（目标/最终回复摘录/验证状态/台账）记为待审运行记录；skip 是显式合法结果。`taskMemoryPromotion` 的任务知识提炼仍走独立的 `AtomicMemoryExtractor`。
- 投递与治理：outbox 在执行前按 ID 原子领取，已完成项只返回结果，后台与直接队列不得重复处理；各路径在投递结束后通知调度器，按最早 `available_at` 自动唤醒、串行排空，应用退出先停止调度再停止边车。可能已发送的写入先按稳定 operation_id 查 save-result 并恢复原 effective ID，禁止未查明结果就换会话重发。远端回执对应的 link 生命周期和 outbox 状态在同一本地事务确认；重放不得复活归档/删除项，历史 link 删除不得破坏其他修订共享的 observation。未发送的 finalize 请求失败可退避，结果不确定的请求不得自动盲目重放，失败后必须清除旧 effective 缓存。持久化 Completed 在检查点回执中映射为 Synced，Superseded 单独表示。
- 注入：每轮前 `buildProjectMemoryContextSafe`，可选召回总等待最多 500ms 并支持取消，预算 project/personal/session = 900/250/350 token。按 observation 修订去重，原生压缩成功后重建注入边界。Chat 不注册记忆/检查点工具或注入记忆指引；IM/Cron 同 Work。旧 `MEMORY.md` 只在启动时导入为候选，永不注入 prompt。

### 其他

- **Artifacts**：HTML/React 跑隔离 iframe，SVG 经 DOMPurify，Mermaid 严格安全模式——改渲染器不得破坏这些边界。
- **TS**：`tsconfig.json`（renderer）、`electron-tsconfig.json`（主进程，CommonJS → `dist-electron/`）；别名 `@` → `src/renderer/`。
- **Skills**：`SKILLs/` 是 Pi 运行时的内置 skill（经 `skills.config.json`），不是 IDE/agent 插件 skill。
- **llama.cpp**：服务级选项管 `llama-server` 进程，模型级选项在加载/运行时传入。实现模块见 [docs/architecture/overview.zh-CN.md](docs/architecture/overview.zh-CN.md)「本地推理」一节。

### 企业扩展（enterprise/）

- `enterprise/` 是知远企业客户端扩展（自 zhiyuanAaaS 仓库迁入，源提交 `7adec4a`）：企业会话、托管模型投影、Agent 控制循环、托管 Skill 与企业设置渲染器。迁移代码保持原仓库结构（`enterprise/src/`），不适用本仓 renderer 的主题与设计体系。
- 独立构建：`bun run build:enterprise` 产出 `enterprise/dist/extension.cjs`（tsup 单文件 CJS）与 `enterprise/dist/ui/`；测试 `bun run test:enterprise`，类型检查 `bun run typecheck:enterprise`，包体验证 `bun run verify:enterprise:bundle`。根 `npm test` 的 include 不覆盖 `enterprise/`。
- 宿主经 `src/main/enterpriseExtension` 契约加载：打包产物位于 `resources/zhiyuan-enterprise/extension.cjs`，开发覆盖用 `ZHIYUAN_ENTERPRISE_EXTENSION_DEV_PATH` 指向本地 bundle。UI bundle 是独立 document，不进入主渲染器主题系统。
- 企业版 Windows 手动入口「Build Zhiyuan Enterprise Windows package (manual)」校验 version/source_ref 后，以 `enterprise-extension: true` 调用普通版 `build-windows-release.yml`；不得另建安装器、签名或安装验收流程。两版共用 `scripts/build-windows.cjs` 和 WebView2 安装壳，企业版仅叠加扩展与独立产品标识（`scripts/packaging/windows-product.cjs`、`electron-builder.enterprise.cjs`）。本地入口 `bun run dist:win:enterprise`。AEP 地址在客户端登录时填写，可修改并持久化到企业版用户数据目录的 `zhiyuan-enterprise/connection.json`；安装包不绑定部署。打包产物有意不含 Admin Console bundle（控制台仍是 zhiyuanAaaS 的 Web 部署应用）。

## 前端设计规则（P0）

适用于全部前端工作，不因改动小、赶时间、委派或使用组件库豁免。

### 事实来源与优先级

- 视觉规范唯一来源是 [DESIGN.md](DESIGN.md)（v4.0 Quiet Studio），具体数值只在那里维护；主界面的参考实现与 CSS 写法标杆见 [docs/design/reference/index.html](docs/design/reference/index.html)（不被 renderer 引用，与 DESIGN.md 冲突时以 DESIGN.md 为准）。优先级：AGENTS.md / DESIGN.md > 参考实现 > 项目 UI skills（`frontend-ui-change-strategy`、`rongxinai-ui-adapter`）> `design-taste-frontend` > `high-end-visual-design` > 组件库默认、历史代码、个人审美。规范间有实质冲突时指出冲突点，不得自选较宽松的一方。
- 改 UI 前必须读 DESIGN.md 相关章节、对照参考实现、读受影响组件及其 token/recipe，并看下方范例。「原来就是这么写的」不是理由。
- 「美化/优化/现代化」不是自由发挥许可。禁止擅自新增色系、字号/圆角/阴影档、毛玻璃、渐变按钮、装饰光晕、悬停上浮/缩放、呼吸动画、嵌套卡片、Hero、导航层级或虚构状态。
- 新视觉语义：先更新 DESIGN.md 与契约，再实现全部主题；禁止先实现再改规范背书。
- 偏离已批准设计须取得用户明确授权（本轮已授权的不重复问），写入 DESIGN.md 并在 PR 列出。其他 agent 同意或工具默认不算授权。
- 禁止绕过验收：不删弱检查项、不关审计、不扩白名单、不加无依据例外、不未经用户验收覆盖基准截图。

### 主界面参考标杆（2026-10-20，DESIGN.md v4.0）

用户审阅 v3 主界面后授权废止 Zenith 的毛玻璃、渐变主按钮、外发光、悬停上浮和放大 30% 字阶，确立 v4.0 Quiet Studio 标准。参考实现位于 [docs/design/reference/index.html](docs/design/reference/index.html)（含 `tokens.css`、`shell.css`、`stage.css`、`main.js`）。主界面浏览器预览基准（1280×800，2026-10-22）：[浅色](docs/theme-previews/main-interface-2026-10-22-light.png)、[深色](docs/theme-previews/main-interface-2026-10-22-dark.png)。文档截图用 `bun run preview:doc-screenshots` 再生。

| 特征 | v4 做法 | 代码入口 |
| --- | --- | --- |
| 一屏一个重心 | 首页重心是输入岛（20px 圆角、强边框、`shadow-sm`→聚焦 `shadow-md`）；品牌只在侧栏出现一次，首页用时段问候语（24px/600），不放大字标 | [CoworkView.tsx](src/renderer/components/cowork/CoworkView.tsx)、[classic-message-surfaces.ts](src/renderer/theme/components/classic-message-surfaces.ts) |
| 品牌色只表示「可执行」 | 品牌蓝只用于有内容时的发送键、对话框主确认、焦点环、链接与运行点；侧栏「新建任务」改用 `secondary-lg` 中性抬升按钮 + 快捷键提示；分段控件与导航选中不用品牌色 | [SidebarNavigationView.tsx](src/renderer/components/shell/SidebarNavigationView.tsx)、[shell-sidebar.ts](src/renderer/theme/components/shell-sidebar.ts) |
| 用面分区，不用线 | 侧栏直接放在窗口底色上；主内容是一块距窗口边 8px、12px 圆角、1px 边框的抬升面板 | [home-studio.ts](src/renderer/theme/components/home-studio.ts)、[zenith-light.ts](src/renderer/theme/themes/zenith-light.ts)、[zenith-dark.ts](src/renderer/theme/themes/zenith-dark.ts) |
| 同一规格、次要信息按需 | 行、按钮、芯片统一 32px 高、8px 圆角、16px 图标，文字起点对齐；会话按「今天/本周」分组，相对时间在 hover/focus 时显示 | [CoworkPromptInput.tsx](src/renderer/components/cowork/CoworkPromptInput.tsx)、[PromptWorkspaceSelector.tsx](src/renderer/components/cowork/PromptWorkspaceSelector.tsx)、[PromptSelectorButton.tsx](src/renderer/components/cowork/PromptSelectorButton.tsx) |
| 引导项轻量、文案一致 | 中性胶囊、动宾短语（制作幻灯片、分析数据、搭建网站、深度调研、学术研究、撰写文档）；默认权限为「敏感操作需确认」，与安全状态文案一致 | [QuickActionBar.tsx](src/renderer/components/quick-actions/QuickActionBar.tsx)、[classic-page-controls.ts](src/renderer/theme/components/classic-page-controls.ts) |
| 明暗成套、外观与行为分离 | token + 注册 hook + recipe；切主题原位更新，保留输入与交互状态；动效只过渡颜色/阴影/透明度（120ms），按压 1px | [home-studio-contract.ts](src/renderer/theme/components/home-studio-contract.ts)、[zenith-light.ts](src/renderer/theme/themes/zenith-light.ts)、[zenith-dark.ts](src/renderer/theme/themes/zenith-dark.ts) |

设置页、列表页用 DESIGN.md 对应范式（行式列表为主，不套多余卡片），不复制首页问候区；引用文件中的遗留代码不因此豁免。

### 已验收范例：2026-10-13 弹窗密度基准

用户以 Codex「编辑项目」弹窗为准核准「舒展大气」密度，规则已写入 DESIGN.md「密度与舒展度」：表单弹窗最小 448px、字段间距 16px、文字 ≥14px、空间不够加宽容器而非缩字号/挤控件；侧栏项目/工作区行是导航行，禁止卡片化包装。后续弹窗与侧栏行必须遵守，验收时对照 [EditProjectDialog.tsx](src/renderer/components/agentSidebar/EditProjectDialog.tsx)。

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

1. 改前对照 DESIGN.md 与 [参考实现](docs/design/reference/index.html)，确认本次涉及的组件、token/recipe 和状态。委派时传递适用规范与验收条件，由委派方验收。
2. 从 DESIGN.md「十、落地检查清单」选择本次改动涉及的项目。渲染和交互用 `bun run web:preview` 验证。需要验证真实 IPC、主进程、文件或系统能力、原生窗口或业务流程时，用 `bun run electron:dev` 检查受影响的路径。

截图、测试、lint 各证明不同事项，互不替代；自动检查不覆盖设计判断。纯文档改动只做一致性与链接检查，不宣称 UI 验收。

## 编码规范

- TypeScript，函数组件 + Hooks；2 空格、单引号、分号。组件 `PascalCase`，函数/变量 `camelCase`，Redux slice `*Slice.ts`。
- 禁止 `any`（确需时旁注理由）。第三方 API/类型先查 `node_modules` 实际声明。
- 禁止内联 `await import()`，一律顶层 import。
- CI 通过 `scripts/ci/check-source-line-limit.mjs` 检查 1000 行源码上限及 `scripts/ci/source-line-baseline.json` 中的存量文件 cap。cap 只能缩小，文件降到 1000 行以内后从 baseline 移除。
- 大范围改动前完整读相关文件，不凭搜索片段判断。
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

- 按 Ponytail 选择足以验证本次改动的检查。
- 修改 token、recipe 或生成器后，用 `bun run theme:generate` 更新生成文件。
- 单测与源码同目录，只用 `.test.ts`，`import { test, expect } from 'vitest'`；避免 import Electron-only API（如 electron-log）。新建/修改的测试必须跑到通过。
- **Provider 回放**：`tests/piLongTaskReplay.test.ts` 用录制磁带（`tests/replay/tapes/longtask-32doc.jsonl.gz`）对完整 Pi adapter 栈跑 32 文档长任务，做严格 seq+hash 匹配，prompt 组装、工具接线或完成语义漂移即失败。prompt/场景有意变更后重录：`AB_LONGTASK=record AB_LONGTASK_UPSTREAM_API_KEY=<token> bunx vitest run tests/abLongTask.harness.test.ts`（live 上游与模型见 `tests/replay/piLongTaskScenario.ts`；2026-10 起算力为 64K 上下文单模型部署，场景规模据此定为 32 文档）。

## Git 与 PR

本仓库可能有多个 agent 会话并行，工作区改动混杂：

- 只提交本会话改的文件：`git add <显式路径>`，禁止 `git add -A` / `.`；提交前 `git status` 核对。
- 禁止 `git reset --hard`、`git checkout .`、`git clean -fd`、`git commit --no-verify`、`git push --force`。
- `git stash` 必带 `-m` 并在本会话尽快 pop。冲突只解自己改过的文件，否则中止问用户。
- 评审 PR 用 `gh pr view` / `gh pr diff` / `gh api`，不 checkout 他人分支。审查等对方声明完成后再做，或约定不重叠文件域；边写边审须标注审查时点。
- 报缺陷前对照 HEAD 验证根因；不确定按「疑似」上报。

**提交**：Conventional Commits，全英文 `type(scope): summary`。type ∈ `feat|fix|refactor|chore|docs|test|perf|style|ci|build|revert`；subject 小写祈使、≤72 字符、无句号；body 写 why；破坏性变更加 `!` 与 `BREAKING CHANGE:` footer；关联 issue 每个都写关键词（`closes #1, closes #2`）。不用 emoji、不写客套话。

**PR** 标题与三段说明遵循 [DEVOPS.md](DEVOPS.md)，写明改动、原因和验证结果。bug fix 补充触发条件、原行为、根因与修复后行为。有 issue 时关联，小修复按需建 issue。必需检查 `ci-gate` 通过后，作者或 agent 可自行 squash 合并。高影响变更仍建议维护者确认。说明适用的 Electron 行为变化（IPC、存储、窗口）。UI 变更记录适用的设计依据、验收结果、获准偏离，以及未验证项和原因。有未通过的设计项或缺必要验收时不得建议合并。

**CI**：`main` 与 `release/**` 的日常 PR/push 仅运行 lint（含格式、Knip、Python 死代码及工作流静态检查）、两片并行单测与 `ci-gate`。单测直接加载 TypeScript；不编译应用、不下载 Electron、不运行浏览器、内存、变异测试或打包安装。重检查统一在 `release-preflight.yml`：手动运行默认包含未签名打包安装；tag 发布调用时由本轮已签名安装验收替代重复的未签名打包。预检各 job 绑定同一个解析后的 commit；类型检查、构建、完整测试、企业工具链、渠道/Python 运行时、浏览器预览与内存回归全部必须通过。tag 构建与预检并行，publish 等待预检与全部平台构建及安装验收通过后，一次发布完整清单。全平台构建、安装和堆分析仅保留手动入口，不因功能改动自动启动。统一必需检查仍为 `ci-gate`；`.github/devops-ci.json` 与触发范围同步。默认分支保护：须经 PR、不要求 approval、不要求解决评审讨论、必需检查仅 `ci-gate`、禁止强推与删除。见 [RELEASING.md](RELEASING.md)。

**项目管理**：使用 [知远数字员工平台](https://github.com/orgs/rongxinzy/projects/2)，主要协作团队为 opensource。需求、缺陷与交付事项加入 Project，复用 Assignees 记录实际负责人，并维护 Status、Priority；Target date 仅填写承诺日期。PR 加入同一 Project，有关联 Issue 时互链；合并完成不代替部署或业务验收。不另建重复台账。

## 协作

- 回答简洁直接；用户提问先回答，再动手。
- 回应评审先明确同意/不同意，再说改了什么。
- 解释非平凡设计按「问题 → 例子 → 方案 → 为何必须」，区分必要与可选复杂度。

## 外部 Skills

- 产品界面（Work/Chat/Settings/MCP/Skills/本地推理等）以 DESIGN.md + 共享组件 + `rongxinai-ui-adapter` 为准，不套营销页默认。landing/营销/品牌页用 `design-taste-frontend`；明确需要高级视觉或复杂动效才读 `high-end-visual-design`。可选 `shadcn/ui`、`vercel/ai-elements`、impeccable（`bunx impeccable install`，`/impeccable`）。

## 跨仓协作规范

提交、PR 和评审遵循 [DEVOPS.md](DEVOPS.md)。

## 文件大小

`.husky/pre-commit` 通过 `scripts/check-new-file-tokens.mjs` 检查新增文件的 5000 token 上限，按字节数除以 4 向上取整估算。脚本对 Markdown、锁文件、二进制及生成文件等设有豁免。
