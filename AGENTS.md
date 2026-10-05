# AGENTS.md

Guidance for coding agents working in this repository.

## 核心原则

1. **Pi Native, Pi First.** 本应用是 Pi 原生应用：`src/main/libs/agentEngine/piRuntimeAdapter.ts` 是唯一执行内核（Work、Chat、Channel、Cron 全部走它）。新能力优先用 Pi 的原生机制实现，不在 harness 层重造 Pi 已有的东西。
2. **Harness 不得劣化 Pi（底线原则）。** harness 层（提示注入、工具包装、闸门、拦截、强制纠偏等）不得浪费 token、制造模型摩擦或扭曲模型行为基线。任何被证明劣化 Pi 原生表现的机制必须移除，不得加固保留。反面案例：强制模型先调 `set_task_output` 声明交付物的输出契约（PR #786 引入、#917 移除）——此类机制不得重新引入。
3. **设计合规是前端交付的 P0 门禁。** 所有开发者、agent 及其委派工具必须遵守下文「设计宪法」：先读规范、按规范实现、渲染后自查、凭证据验收。功能可用或测试通过不能抵消设计违规；未完成设计自查不得宣称前端工作完成。

## Build and Development Commands

```bash
npm run electron:dev       # Vite + Electron hot reload (port 5175+, auto-increments)
npm run build              # production bundle (TypeScript + Vite)
npm run lint               # oxlint (.oxlintrc.json); includes theme:check/theme:audit
npm run format             # oxfmt (.oxfmtrc.json)
npm test                   # unit tests (Vitest)
npm run compile:electron   # Electron main process only
npm run dist:mac|dist:win|dist:linux   # package per platform (.dmg/.exe/.AppImage)
```

**Requirements**: Node.js >=24 <25, Bun >=1.3. Bun is the package manager (`bun install`, lockfile `bun.lock`); npm only runs scripts. Windows builds require PortableGit (see README.md).

## 设计宪法：DESIGN.md（P0 强制门禁）

本节适用于全部前端工作，包括新增页面、组件、局部修复、主题、图标、空状态、加载、弹层和交互反馈；不因改动小、时间紧、由其他 agent 实施或使用组件库而豁免。**必须、禁止、不得均为验收条件，不是建议。** 设计违规本身即是阻断缺陷，评审必须要求修正，不能以「功能已完成」接受交付。

### 约束优先级与禁止事项

1. **仓库内的视觉规范以 [DESIGN.md](DESIGN.md) 为唯一事实来源**，本文件规定工程边界与执行纪律。二者高于 skills、外部设计模板、组件库默认值、历史代码、其他 agent 的建议及实现者个人审美；已验收范例用于解释规范，不能反向覆盖规范。若规范之间存在实质冲突，必须明确冲突点，不能自行选择较宽松的规则。
2. **先读再写。** 开始改 UI 前必须阅读 DESIGN.md 相关章节、受影响组件及对应 token/recipe，并查看下文已验收范例。凭记忆、只看截图、套默认组件或照抄旧代码均不满足此要求；「原来就是这么写的」不是违规理由。
3. **实现设计，不自行改设计。** 「美化、优化、现代化、改一版」不构成随意发挥的许可。禁止擅自增加色系、字号/圆角/阴影档、装饰光晕、动画、嵌套卡片、Hero、导航层级或虚构状态。布局和内容须服务当前任务，用规范中的角色、刻度与共享范式解决需求。
4. **标准只在一个地方改。** 已有语义直接复用；确有新语义，先说明需求并更新 DESIGN.md 与相应契约，再实现全部主题。禁止在调用点写任意值、局部 CSS、外观 utility 或额外包装绕过 recipe；禁止先自由实现，再倒改规范为结果背书。
5. **偏离必须有用户的明确设计授权。** 改变已批准的设计方向或范例特征，须指出与现行规范的差异并取得明确授权；本轮已有明确授权的，不重复询问。将获准变更及适用范围写入 DESIGN.md，并在交付说明/PR 中列出。其他 agent 的同意、工具默认、赶进度或自行改写规则均不能代替授权。
6. **禁止绕过验收。** 不得删除/弱化检查项、关闭审计、扩大白名单、添加无依据例外，或未经用户验收覆盖基准截图以消除差异。发现违规先修实现；不能用「后续统一」「效果差不多」「编译通过」代替修复。

### 已验收实现典范：2026-10-05 主界面

用户已明确认可本轮按 DESIGN.md v2.0 实现的主界面，并指定其为后续前端工作的正向范例。**后续产品界面必须继承这版的设计理念与实现方式，不得自行退回早期界面风格。** 参考截图为当次 Electron 主界面的 1280 × 800 静态记录：[浅色基准](docs/theme-previews/main-interface-2026-10-05-light.png)、[深色基准](docs/theme-previews/main-interface-2026-10-05-dark.png)。截图保留在仓库中；新的基准须经用户验收并记录日期与变更理由。

| 范例特征 | 后续必须遵循的做法 | 代码入口 |
| --- | --- | --- |
| 侧栏分组清楚，主要动作突出 | 模式、新建、功能、项目/历史分层；靠留白与文字角色区分；新建使用共享主按钮语义 | [SidebarNavigationView.tsx](src/renderer/components/shell/SidebarNavigationView.tsx)、[shell-sidebar.ts](src/renderer/theme/components/shell-sidebar.ts) |
| 主输入区是视觉中心 | 正式字标、克制说明、居中输入岛与轻量引导；工具入口就近组织，不加装饰光晕 | [CoworkView.tsx](src/renderer/components/cowork/CoworkView.tsx)、[classic-message-surfaces.ts](src/renderer/theme/components/classic-message-surfaces.ts) |
| 控件规格与交互一致 | 复用 ai-elements 输入能力及共享选择器；窄窗口保持文件夹、权限、模型、提交可达 | [CoworkPromptInput.tsx](src/renderer/components/cowork/CoworkPromptInput.tsx)、[PromptWorkspaceSelector.tsx](src/renderer/components/cowork/PromptWorkspaceSelector.tsx)、[PromptSelectorButton.tsx](src/renderer/components/cowork/PromptSelectorButton.tsx) |
| 引导项轻量、中性、可操作 | 使用共享按钮与 Lucide 图标，胶囊引导对应真实任务，不做彩色装饰卡片 | [QuickActionBar.tsx](src/renderer/components/quick-actions/QuickActionBar.tsx)、[classic-page-controls.ts](src/renderer/theme/components/classic-page-controls.ts) |
| 明暗成套，外观与行为分离 | 外观通过 token、注册 hook 和 recipe 统一定义；切主题原位更新，保留输入与交互状态 | [home-studio.ts](src/renderer/theme/components/home-studio.ts)、[home-studio-contract.ts](src/renderer/theme/components/home-studio-contract.ts)、[classic-light.ts](src/renderer/theme/themes/classic-light.ts)、[classic-dark.ts](src/renderer/theme/themes/classic-dark.ts) |

本范例确立的是产品界面的克制层级、统一控件、主题归属和状态连续性；设置页、列表页等应采用 DESIGN.md 对应范式，不能机械复制首页 Hero。其他主题保留自己的完整色板。引用文件中的遗留代码不因此获得豁免，截图也不证明所有功能和运行状态已验收；具体数值及完整要求仍只在 DESIGN.md 维护。

### 必须执行的前端工作流程

1. **修改前对齐**：简要列出本次涉及的 DESIGN.md 章节、复用组件、token/recipe 入口和受影响的状态/页面。没有规范依据的设计选择先收敛到已有范式；这一步用于明确实施依据，不额外引入例行审批。
2. **实现时守界**：布局与业务装配留在页面/组件，外观进入主题 recipe；优先复用已有语义。委派时必须传递相关规范、范例和验收条件，发起委派者负责最终逐项验收，不能只接受下游「已完成」的结论。
3. **修改后先自查再交付**：逐项完成 DESIGN.md「十、落地检查清单」，并对照本节的已验收范例检查设计理念。每项标为「通过 / 不适用（理由）/ 未通过（问题）」；发现问题继续修复并复查，不把自查留给用户。
4. **同时核对代码与实际渲染**：检查差异中的外观归属、共享组件和契约；启动 Electron 检查受影响界面。截图、测试、lint 各自证明不同事项，任何一项都不能代替其他必要验证。执行下文「主题系统」「验证纪律」规定的命令与适用流程。
5. **带证据交付**：交付说明/PR 必须含简短设计自查结果，列明规范依据、主题与窗口尺寸、相关状态/操作、截图位置、检查命令结果、获准偏离及未验证项。禁止只写「符合设计」「已自测」。环境阻塞必须如实列出证据和影响范围，不能标为通过；有未通过的设计项时，不得宣称设计验收完成或建议合并。

自查必须能回答以下问题，并以实际界面或代码位置为依据：

- **理念**：视觉中心是否清楚，主要动作是否突出，分组是否靠留白和字阶建立；是否新增了多余颜色、边框、阴影、动效、卡片层或重复标题？
- **实现**：颜色、字阶、圆角、间距、控件规格、图标、品牌资产是否遵守 DESIGN.md；是否使用规定的组件、token 与 recipe；是否存在调用点绕过或仅适配单一主题？
- **交互**：明暗、适用状态、键盘/焦点、窄窗口、长文本、动态内容和 portal 是否实际检查；热切换是否保留草稿、焦点、选中、弹层和滚动；减少动效是否保留必要反馈？
- **证据**：截图对应哪个界面和状态，哪些操作已验证，哪些未覆盖，命令是否真正通过；是否明确区分视觉验收、功能验收与构建/发布结果？

纯规范/文档修改只做文档一致性、链接与差异检查，不据此宣称 UI 验收完成。**P0 是项目验收约束；现有自动检查未覆盖的设计理念和视觉判断，仍必须人工或由 agent 实际渲染自查，不能假定 CI 会兜底。**

## Architecture Overview

知远智能体 (ZhiYuan Agent)：Electron + React 的本地优先 AI Agent 桌面应用。核心：Cowork 会话（Pi 运行时驱动）、llama.cpp 本地推理、Skills/MCP、Artifacts 预览（HTML/SVG/React/Mermaid）。严格进程隔离 + IPC 通信。

**品牌与焦土政策**：对外文案只用「知远智能体 (ZhiYuan Agent)」，旧名一律不得复活。Pi、cc-connect、llama.cpp 是内部实现细节，禁止出现在品牌或用户可见文案中，对外称全栈自研。旧标识与旧运行时按焦土政策处理：不做数据迁移、兼容层、读取、启动、打包或回退；旧数据原地弃置，不主动删除。

### Process Model

- **Main** (`src/main/main.ts`)：窗口生命周期；SQLite（better-sqlite3，`src/main/sqliteStore.ts`）；Agent 运行时（`src/main/libs/agentEngine/piRuntimeAdapter.ts`）；Channel/Cron 传输（`src/main/libs/ccConnect*`、`src/main/im/`——只搬运事件与 cron 触发，不执行 Agent、不持有任务状态）；llama.cpp 生命周期（`src/main/libs/llamacppManager.ts`、`src/shared/llamacpp/`）；Skill 管理（`src/main/skillManager.ts`）；MCP 配置；IM/email 网关（对外渠道：微信、企业微信、钉钉、飞书/Lark、QQ、Email；旧 connector 代码不得在 UI/文档中重新暴露）；40+ IPC handler。安全：contextIsolation 开、nodeIntegration 关、sandbox 开。
- **Preload** (`src/main/preload.ts`)：contextBridge 暴露 `window.electron`，含 `cowork` 命名空间（会话管理与流事件）。
- **Renderer**（React，`src/renderer/`）：全部 UI 与业务逻辑，只经 IPC 与主进程通信。

### Authentication Flow

浏览器登录 → deep-link 一次性 `authCode` 换 2h access token + 30d refresh token（SQLite `auth_tokens`）。`fetchWithAuth()` 带 Bearer；401 或剩余不足 5 分钟时刷新并轮换 refresh token；30 天未用则清除。实现：`src/renderer/services/api.ts`、`src/main/main.ts`、`src/main/sqliteStore.ts`。

### Main Process / Worker Boundary

主进程持有生命周期、IPC、安全决策、持久状态与顺序，必须保持响应：请求/IPC/agent 流路径上禁止同步递归扫盘、整文件读/哈希、大 JSON/Markdown 解析、重正则扫描、压缩等 CPU 密集工作。此类工作放 Node `worker_threads`（入出参可序列化、与可变状态隔离；有界池最多 2 个、可取消、限输入/队列、结构化错误、尽量传 ArrayBuffer）。主进程负责校验路径与结果、写操作、用户可见状态，并记录新 worker 任务的排队/运行耗时。**永不越界**：Electron API、SQLite 连接/事务、agent 会话生命周期、工具审批、流排序、密钥、renderer/DOM——Worker Thread 不会让 SQLite 并发变安全。

**Touch-to-refactor**：改动含阻塞性扫描/哈希/解析/转换的组件时，同 PR 必须把它抽到 Worker（Skill 安全扫描、artifact 收集哈希、备份快照哈希、模型目录扫描、大 artifact 解析等），附 worker 边界测试与前后耗时/事件循环延迟证据；组件持有的禁止性状态操作要抽出全部可分离的纯阻塞部分并在 PR 说明保留边界。

### Data Flow

1. 初始化：`App.tsx` → `coworkService.init()` → IPC 加载配置/会话 → 建立流监听。
2. 会话：用户发 prompt → `coworkService.startSession()` → IPC → `PiRuntimeAdapter` → 流事件回 renderer → Redux。
3. 工具权限：引擎发 `permissionRequest` → `CoworkPermissionModal` → 用户批准/拒绝 → 结果回引擎。
4. 持久化：`cowork_sessions` / `cowork_messages` 表。
5. 本地推理：renderer 走 llama.cpp IPC → 主进程管理 `llama-server` 与模型安装/加载/参数。

### Cowork System

- 执行模式（`CoworkExecutionMode`）：`auto` / `local`。
- `cowork:stream:*` 承载 Work/Chat 事件；Channel/Cron run 以只读 activity 投影暴露。
- 流事件：`message` / `messageUpdate` / `permissionRequest` / `complete` / `error`。关键 IPC：`cowork:startSession`、`continueSession`、`stopSession`、`getSession`、`listSessions`、`deleteSession`、`respondToPermission`、`getConfig`、`setConfig`。

**Managed Python runtimes**：两层，首启同步到 `userData/runtimes/`。

- `resources/python-win|mac|linux`：裸便携 CPython（uv 管理），agent shell PATH 上的基础解释器，`UV_PYTHON` 绑定之；Windows 带 `python.exe` + `python3.exe`。
- `resources/skill-python/layers/shared`：基于基础运行时的单个可迁移 uv venv，合并所有内置 Skill 的 requirements（pandas、numpy、openpyxl 等）；其解释器被前置到 agent shell PATH（`applyManagedPythonEnv`，`src/main/libs/managedPythonEnv.ts`），临时脚本可直接 `import pandas`。Windows 层在 `python.exe` 旁补 `python3.exe` 别名（uv venv 不创建；安装脚本创建，运行时 `ensureSharedSkillWindowsPython3Alias` 自愈）。Skill 脚本执行（`run_skill_script`）经 `findSkillPythonExecutable` 解析，并强制 per-Skill `requirementsSha256` manifest 门。

模型面策略在三处，必须同步：SYSTEM_PROMPT.md（托管环境与工具节）、`piSystemPromptContributions.ts` 的 `python-runtime` contribution（`piPythonEnvGuidelines.ts`，用户覆盖系统提示后仍生效）、`piBashToolGuidelines.ts` 的 `getPiBashPythonEnvViolation`（机械拦截向托管解释器 pip install、直接 `python` 调内置 Skill 脚本）。

**Memory System**：本地 Engram runtime（`vendor/engram-runtime`）+ SQLite 投影表（`memory_links`、`memory_candidates`、`memory_outbox`），三作用域：

- `project`：工作区事实与决策，project id = `workspace-` + sha256(cwd)（`src/main/workspaceUtils.ts`、`src/shared/memory/constants.ts`）。
- `personal`：跨工作区偏好，固定 id `personal://zhiyuan-agent/user`；写入进候选队列，用户在设置中确认后生效。
- `session`：会话摘要，30 天 TTL。
- 写入：Work 模式 agent 的 `memory` 工具（`src/main/memory/piMemoryTool.ts`：recall/list/save/propose_personal）先经 `AtomicMemoryExtractor` 证据抽取；每轮后 `runPostTurnMemoryMaintenance` 滚动会话摘要。
- 注入：每轮前向 prompt 前置记忆块（`buildProjectMemoryContextSafe`，project/personal/session token 预算 900/250/350）。Chat 不用记忆；IM/Cron 与 Work 同管线。旧 `MEMORY.md` 仅启动时导入为审查候选，永不注入 prompt。

### 其余要点

- **Artifacts**：HTML/SVG/Mermaid/React/code，经 `artifact:*` 围栏或启发式识别；HTML/React 跑隔离 iframe，SVG 用 DOMPurify 消毒，Mermaid 严格安全模式——改渲染器时保持这些边界。
- **Markdown**：`react-markdown` + `remark-gfm` + `remark-math` + `rehype-katex`。
- **配置**：应用配置在 SQLite `kv` 表；Cowork 配置在 `cowork_config`（workingDirectory、systemPrompt、executionMode、agentEngine）；Task/Run/Delivery/ChannelAccount/ChannelSession 以 ZhiYuan SQLite 为准；库文件 userData 下 `zhiyuan.sqlite`（旧库文件不迁移不读取，焦土）。
- **TS 配置**：`tsconfig.json`（renderer，ES2020/ESNext modules）；`electron-tsconfig.json`（主进程，CommonJS → `dist-electron/`）。路径别名 `@` → `src/renderer/`。
- **i18n 机制**：`services/i18n.ts` 键值对，zh（默认）/en，首启按系统语言探测。
- **Skills**：内置 skill 定义在 `SKILLs/`，经 `skills.config.json` 配置。
- **llama.cpp 参数**：服务级选项管 `llama-server` 进程；模型级选项在加载/运行时传入。
- **关键依赖**：Pi SDK（执行内核）、cc-connect sidecar（仅 Channel/Cron 传输）、better-sqlite3、react-markdown 系、mermaid、dompurify。

## UI 组件与设计约束

两套组件库，**先查再写，禁止自造轮子**。用户只能选整套主题 + 浅色/深色/跟随系统，不提供其他独立样式设置。

- **shadcn/ui**（`src/shared/components/ui/`）：基础组件。页面 tab 只用 `PageTabs`（放 PageHeader 的 tabs 槽）、分段/筛选只用 `FluidTabs`、删除确认只用 `DestructiveConfirmDialog`——禁止手搓 tab、分段条、确认框。
- **ai-elements**（`src/shared/components/ai-elements/`）：对话组件（conversation、message、prompt-input、code、reasoning、tool、attachment、source、suggestion、loading、terminal），聊天/推理展示必须用它，不要自己拼。
- 图标一律 `lucide-react`，禁止手写 SVG 图标组件。
- 页面顶栏一律 `src/renderer/components/PageHeader.tsx`（h-12/px-4/draggable/border-b/折叠按钮组/mac 留白/WindowTitleBar），禁止手写顶栏；页面标题只在 PageHeader 出现一次，内容区 hero 不重复。
- Button 的 className 只许布局类（`w-full`、`justify-start`、`gap-*`）；颜色/圆角/阴影/字重/字号/高度走 variant/size 枚举。行级可点区域不用裸 `div onClick`（细则见 DESIGN.md「Button 使用纪律」）。
- 结构组合用 Tailwind `className` + `cn()`（`@shared/lib/utils`）；控件外观属于主题 recipe，禁止页面局部 CSS 或外观工具类绕过。

### 主题系统

主题包是仓库内注册的展示数据（非可执行插件或用户 CSS）。事实来源：`themes/plugins.ts`（注册，每套主题必须同时提供 light/dark 完整外观，不得复制页面分支）、`themes/types.ts`（`ThemeDefinition` = tokens + components + 可选 background；token 契约 `tokens/contract.ts`，组件 hook/状态/属性白名单 `components/contract.ts`）、`theme/components/`（各控件外观 recipe，共享组件只绑定稳定 hook、语义 variant/size 与真实状态）、`engine/` 与 `components/css.ts`（变量/规则生成与原位应用）。`css/themes.css` 只能由 `bun run theme:generate` 生成，禁止手改或全局覆盖修补。入口与验证边界另见 `src/renderer/theme/README.md`。

规则：

1. 布局归组件/页面（DOM、排列、滚动、命中区域、键盘、焦点、禁用语义、父容器填充、flex 收缩），外观归 recipe（控件自身固定尺寸、内边距、字体、边框、圆角、阴影、透明度、状态动效）。
2. 改外观先定位现有 recipe；新视觉语义先扩共享 variant/size 或注册组件 hook，再补齐所有已注册主题。禁止在页面/包装组件/原生控件/运行时 DOM 写局部颜色、圆角、阴影、字号、尺寸或状态样式；语义色 utility 也不能绕过控件 recipe。
3. 每个 hook 必须声明 `COMPONENT_STATES` 全部状态（无独立视觉用 `recipe()` 补空对象继承，不能漏字段）。主题只能填白名单属性；禁止任意选择器、脚本、事件、IPC、CSS 注入、未登记变量。稳定 hook 不得依赖会被包装层替换的 `data-slot`；第三方样式优先级适配只放引擎固定集成点，不得提权重或 `!important`。
4. 切主题不得改 React key、重建编辑器、清草稿，不得改变焦点顺序、滚动、选中项、弹层、事件和持久化行为；动效遵守 `prefers-reduced-motion`。
5. 背景（颜色/本地图片/内置纹理/图层透明度）由主题包统一提供，不新增用户侧独立设置、存储键或覆盖入口。

验证：改 token/recipe/生成器后跑 `bun run theme:generate`；提交前 `npm run lint`（含 theme:check/audit），不得用关审计、放宽白名单或加例外代替迁移。共享契约/引擎改动跑 `npx vitest run src/renderer src/shared`、`npm run build`、`npm run test:bundle-budget`。实际渲染验证覆盖 light/dark、键盘焦点、适用交互状态（hover/pressed/selected/disabled/invalid/open）与 reduced-motion；改组合控件时验证包装层、portal、动态内容；用改了 recipe 的主题做热切换，确认新值生效且草稿/焦点/选中/弹层保留；检查实际尺寸与溢出，不以截图相似或编译通过推断功能不变。

## Coding Style

TypeScript、函数组件 + Hooks；非 UI 逻辑放 `src/renderer/services/`。2 空格缩进、单引号、分号。命名：组件 `PascalCase`、函数/变量 `camelCase`、Redux slice `*Slice.ts`。Tailwind v4 提供布局与语义 token 工具类（`src/renderer/index.css`、`src/renderer/theme/css/tailwind.css`，无 `tailwind.config.js`）；v4 原生支持 shorthand variant（`data-active:bg-background`、`data-disabled:opacity-50` 等，优先于 `data-[active]:` 全写）。

**文件行数上限**：新文件目标 ≤800 行、硬上限 1000 行（用子组件、职责拆分、`types.ts` 达标）。已有超长文件禁止继续追加——新逻辑写新文件再 import；不主动拆分旧文件，除非用户明确要求重构。

## 协作与沟通

- 回答简洁直接，只写技术内容；commit、issue、PR 评论不用 emoji、不写客套话。
- 用户提问时先回答问题，再动手改代码或跑命令。
- 回应反馈或方案评审时，先明确同意/不同意，再说改了什么。
- 解释非平凡设计按「问题 → 具体例子 → 方案 → 为什么必须这样做」，区分必要复杂度与可选复杂度。
- 用户指令与本文件冲突时，先请求明确确认，再执行。

## 代码质量红线

- 大范围改动前完整读相关文件，不凭搜索片段下判断。
- 禁止 `any`（确有必要时旁注理由）；第三方库 API/类型先查 `node_modules` 实际声明，不凭记忆猜。
- 禁止内联 `await import()`，一律顶层 import。
- 删除看似有意为之的功能或代码前，先问用户；不做用户未要求的向后兼容（与焦土政策一致）。
- 不靠降级或删代码绕过过期依赖的类型错误——升级依赖。
- 临时脚本写临时文件执行、用完删除；不在 bash 命令里嵌多行脚本。

## 验证纪律

- 代码改动（非文档）后运行 `npm run lint`，看完整输出，清零所有警告再提交；提交前 `bun run format:check`（CI 拦截未过 oxfmt 的改动）。
- 新建或修改测试文件后，必须运行该测试并迭代到通过。
- 全量测试存在少量环境相关的存量失败（skill smoke、release manifest 等）。遇到失败先用 `git stash` 对照 HEAD 判断是否由你的改动引入：既不把存量失败算到自己头上，也不拿它为自己的回归开脱。

## 依赖纪律

依赖与 `bun.lock` 变更视同代码评审：只在确有必要时新增，先确认仓库内没有现成能力。直添依赖锁定精确版本，安装用 `bun install`。含原生模块（better-sqlite3、node-pty）的依赖变更后，用 `npm run rebuild:electron-native` 重建。

## String Literal Constants

判别值、状态码、IPC channel 名、模式选择器等被多处比较/switch 的字符串**禁止裸字面量**：

```typescript
// 每模块一个 constants.ts（范例：src/scheduledTask/constants.ts）
export const SessionTarget = {
  Main: 'main',
  Isolated: 'isolated',
} as const;
export type SessionTarget = (typeof SessionTarget)[keyof typeof SessionTarget];
```

规则：每模块单一事实来源；构造、比较、测试（source 和 test 文件同样）都用常量（写 `SessionTarget.Main` 不写 `'main'`）；接口里的判别字段保持字面量以定义联合形状（`kind: 'at'`），常量值与之对齐；所有 `ipcMain.handle()` / `ipcRenderer.invoke()` 必须引用 `IpcChannel` 常量。不必常量化的：外部透传的平台标识（`'feishu'`、`'weixin'` 等）、单点一次性字符串（错误消息、log tag）、Tailwind/React 管理的 UI 层字符串。

## Logging Guidelines

主进程经 `src/main/logger.ts`（electron-log）接管全部 `console.*` 并按日轮转——`src/main/` 直接用标准 console API，禁止另引日志库。

- 级别按重要性：`console.error` 不可恢复故障；`console.warn` 意外但可恢复/降级；`console.log` 关键生命周期（服务启停、连接建立/断开、会话创建/销毁、配置变更）；`console.debug` 仅调试细节。
- 消息是带 `[ModuleName]` 标签的**纯英文自然语句**，不是变量转储：写 `received 5 messages` 不写 `historyMessages: 5`；写 `session not found` 不写 `sessionId: null`。
- 高频路径（轮询、心跳、同步循环）禁止 info 级逐 tick 日志——用 `console.debug` 或删除，只有发生有意义变化时才可一行 info 摘要。不做函数入口日志。
- 一行一事；error/warn 带可追踪标识（session ID、channel key）；error 必须把错误对象作最后参数：`console.error('[Module] operation failed:', error)`。

## Testing Guidelines

- Vitest 单测与源码同目录，**只用 `.test.ts`**（`src/main/foo.ts` → `src/main/foo.test.ts`），`import { test, expect } from 'vitest'`，禁止 `.test.mjs` 等其他扩展。`npm test` 全量，`npm test -- <name>` 过滤。
- 测试避免 import Electron-only API（electron-log 等），相关逻辑内联。
- **Provider 回放道**：`tests/piLongTaskReplay.test.ts` 用录制磁带（`tests/replay/tapes/longtask-200doc.jsonl.gz`）对完整 Pi adapter 栈跑 200 文档长任务，严格 seq+hash 请求匹配——prompt 组装、工具接线、运行完成语义漂移即失败。prompt 或场景变更后用 `AB_LONGTASK=record npx vitest run tests/abLongTask.harness.test.ts` 重录（live 上游见 `tests/replay/piLongTaskScenario.ts` 的 `LONGTASK_LIVE_UPSTREAM`）。
- UI 改动用 `npm run electron:dev` 验证受影响的关键流程：Cowork（发 prompt、批准/拒绝权限、停止会话）、Artifacts（HTML/SVG/Mermaid/React 预览）、Settings（主题/语言切换）。保持 console 警告/错误干净；交付必须附「设计宪法」要求的设计自查结果与渲染证据，功能测试通过不等于设计验收通过。

## Internationalization (i18n)

用户可见字符串一律走 i18n，禁止硬编码：renderer 用 `src/renderer/services/i18n.ts` 的 `t()`；主进程（托盘、会话标题、通知等）用 `src/main/i18n.ts` 的 `t()`。新键必须 zh/en 双语齐全，不确定先留 `// TODO: translate` 注释。仅 DevTools/日志可见的错误信息豁免。

## Commit & Pull Request Guidelines

提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/)，全英文：`type(scope): summary`。

- type：`feat` / `fix` / `refactor` / `chore` / `docs` / `test` / `perf` / `style` / `ci` / `build` / `revert`；scope 为受影响区域（`feat(cowork):`、`fix(im):`）。
- subject 小写祈使句、≤72 字符、无句号；body 用英文 markdown 写 **why** 不写 what；破坏性变更在 type/scope 后加 `!` 并附 `BREAKING CHANGE:` footer。
- 关联 issue 用 `closes #N`；多个 issue 每个编号前重复关键词（`closes #1, closes #2`）。
- PR 附简要描述、链接 issue；UI 变更必须附明暗截图及「设计宪法」要求的设计自查结果，并在描述中说明 Electron 行为变化（IPC、存储、窗口）。设计违规或必要验收缺失时不得建议合并。

## DevOps

### Git workflow

PR 工作流：分支 → PR → 门禁全绿 → 合并。多会话共处规则（本仓库可能有多个 agent 会话并行，工作区改动相互混杂）：

- 只提交本会话改的文件：`git add` 用显式路径，禁止 `git add -A` / `git add .`；提交前 `git status` 核对暂存区。
- 禁止 `git reset --hard`、`git checkout .`、`git clean -fd`、`git commit --no-verify`、`git push --force`——会摧毁其他会话的工作或绕过检查。
- `git stash` 必带 `-m` 说明并在同会话内尽快 pop。rebase/merge 冲突只解自己改过的文件；冲突出现在没碰过的文件时，中止并问用户。
- 评审 PR 用 `gh pr view` / `gh pr diff` / `gh api`，不为此 checkout 别人的分支。
- 审查类工作等对方会话声明完成后再做，或提前约定互不重叠的文件域；边写边审时报告须标注审查时点，结论只对该瞬间成立。
- 报缺陷前先验证根因（对照 HEAD 或 `git stash` 区分新引入与历史遗留），不靠推断下结论；根因不确定按"疑似"上报。

### CI 设计

主入口 `.github/workflows/ci.yml`（PR/push 到 main 触发；同 PR 新推送自动取消旧运行）。范式：**基线门禁永远运行，重型检查按路径选择，单一聚合门禁收口**。

- **路径门控**：`changes` job 用 `scripts/ci/gates/plan.ts`（策略在 `policy.ts`）对完整 PR diff 做路径匹配，决定哪些重型检查必须跑。未知事件类型一律全跑（宁可多跑不可漏跑）；手动 `workflow_dispatch` 是全覆盖逃生口。
- **基线（永远运行）**：`lint`（actionlint 校验所有 workflow、skill frontmatter 校验、openclaw 解耦检查、format:check、lint）、`test`（compile:electron + Vitest 单测 + presentation-studio 自测）、`bundle-budget`（tsc 类型检查 + vite 构建 + bundle 预算）。
- **重型（按需）**：`linux-install` / `windows-install`（打包输入或主进程变更时）、`memory-leak`（主进程或 renderer 热路径变更时），以 reusable workflow 调用。
- **merge-gate**：唯一合并门禁，`always()` 运行，`scripts/ci/gates/verify.ts` 要求全部基线 + 被选中的重型检查成功。
- **author-review-gate**：受管控作者的 PR 必须获指定评审人 approve；用 `pull_request_target` 执行 main 上的版本（防作者在分支里改写门禁使其失效），不检出 PR 代码、仅调 REST API，无注入面。
- 发布流水线独立于 PR 门禁：`daily-release`（定时）、`release-candidate`、`online-update-*` 及各平台签名 workflow。

## Agent-specific notes

- `SKILLs/` 是 Pi 运行时使用的内置 skill 定义，别与 IDE/agent 插件 skill 混淆。
- Claude Code 经 CLAUDE.md 读本文件。UI 工作可参考全局 skills：`shadcn/ui`、`vercel/ai-elements`、`rongxinai-ui-adapter`（项目适配层：`--zy-*` 主题映射、页面级组件选择矩阵、i18n 与常量约定）——它们补充而非替代本文件约定。
- 前端开发推荐安装 impeccable skill：在项目目录运行 `npx impeccable install`（[impeccable.style](https://impeccable.style/)），之后用 `/impeccable` 命令做界面设计、打磨与 AI-slop 检查；它尊重现有设计系统（会读取 DESIGN.md）。
- 前端 skill 路由：产品界面（Work/Chat/Settings/MCP/Skills/本地推理等）以 `DESIGN.md` + 共享组件 + `rongxinai-ui-adapter` 为准，不套用营销页默认；landing/营销/作品集/品牌用 `design-taste-frontend`；产品重设计仍须先遵守「设计宪法」，不能借重设计或技能建议绕过已验收基准。明确需要高级视觉或复杂动效才读 `high-end-visual-design`。冲突优先级：`AGENTS.md` / `DESIGN.md` > 项目 UI skills（`frontend-ui-change-strategy`、`rongxinai-ui-adapter`）> `design-taste-frontend` > `high-end-visual-design`；任何 skill 都不能取消设计自查。
