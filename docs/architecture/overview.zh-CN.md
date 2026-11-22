# 架构概览

知远智能体 (ZhiYuan Agent) 是 Electron + React 的本地优先桌面 Agent。渲染进程只做 UI 与编排；主进程持有 SQLite、Pi 执行内核、本地推理进程与 IPC。

## 进程与信任边界

| 进程 | 路径 | 职责 |
| --- | --- | --- |
| Main | `src/main/` | 窗口、持久化、Pi 运行时、llama.cpp 生命周期、Skill/MCP、IPC handler |
| Preload | `src/main/preload.ts` | `contextBridge` → `window.electron`（contextIsolation 开、nodeIntegration 关、sandbox 开） |
| Renderer | `src/renderer/` | React UI；业务逻辑在 `src/renderer/services/`，禁止直接访问 Node/Electron |
| Channel 传输 | `src/main/libs/ccConnect*`、`src/main/im/` | 接收渠道事件、投递消息和定时任务结果 |
| Cron 调度 | `src/scheduledTask/` | 用本地时钟触发，通过 Pi 执行，在主进程统一停止接收并等待执行收尾 |

主进程在 IPC/agent 热路径上不得做同步整盘扫描、大文件读/哈希、重解析等 CPU 密集工作；可分离部分进 `worker_threads`（池 ≤2、可取消）。详见 [AGENTS.md](../../AGENTS.md)「主进程 / Worker 边界」。

## 目录导览

### 主进程

| 路径 | 说明 |
| --- | --- |
| `src/main/main.ts` | 应用入口、窗口与生命周期 |
| `src/main/sqliteStore.ts` | `userData/zhiyuan.sqlite`（better-sqlite3） |
| `src/main/ipcHandlers/` | IPC 注册；本地推理见 `ipcHandlers/llamacpp/` |
| `src/main/libs/agentEngine/` | **Pi 唯一执行内核**（见下节） |
| `src/main/libs/llamacppManager.ts` | 本地模型库、运行时安装与能力探测的公共入口 |
| `src/main/libs/llamacppBackendManager.ts` | 后端/runtime 安装 barrel（实现于 `llamacppBackendManager/`） |
| `src/main/skillManager.ts` | Skill 状态与目录根管理。目录扫描、元数据解析和图标编码由现有有界 Worker 池执行，主进程持有 SQLite 状态并验证返回结果。Windows 删除残留由监听器异步串行清理，应用退出时停止接收新清理并等待当前文件操作。 |
| `src/main/pythonRuntime/` | 共享预装基线、工作区隔离的托管 Python 与统一 Skill 执行链路 |
| `src/main/memory/` | Engram 投影与 `memory` 工具 |
| `src/shared/llamacpp/` | 主/渲染共享的 llama.cpp 类型与常量 |

### 渲染进程

| 路径 | 说明 |
| --- | --- |
| `src/renderer/App.tsx` | 壳层、Cowork 初始化 |
| `src/renderer/services/cowork.ts` | Cowork IPC 与流订阅 |
| `src/renderer/services/` | API、toast、持久化 KV 适配器等 |
| `src/renderer/store/` | **Redux** 内存状态（与会话 UI 同步） |
| `src/renderer/components/conversation/` | 会话舞台（`ConversationStage` / 懒加载 `SessionStage`、`projectSessionToTurns` 回合投影、`ConversationThread` + `TurnView`） |
| `src/renderer/components/cowork/` | Work/Chat 视图容器、工作区/面板与权限弹窗 |
| `src/renderer/browserMock/` | 浏览器预览 mock（仅 DEV、无 preload 时） |
| `src/shared/components/` | shadcn/ui、ai-elements 等共享 UI |

### 其它

| 路径 | 说明 |
| --- | --- |
| `SKILLs/` | Pi 运行时内置 skill（`skills.config.json`） |
| `MCPs/` |  bundled MCP |
| `enterprise/` | 企业扩展（独立构建，见 `docs/enterprise-extension.zh-CN.md`） |
| `scripts/ci/` | CI 门禁（行数、Knip、toast AST 等） |
| `.github/workflows/` | CI、`release.yml`、`promote.yml` 等 |

## Pi 运行时（Agent 引擎）

**Pi First：** `src/main/libs/agentEngine/piRuntimeAdapter.ts` 是 Work / Chat / Channel / Cron 与伴侣聊天的**唯一**执行内核。新能力优先用 Pi 原生机制，不在 harness 层重造。

启动时先恢复未结束的运行并应用企业与 MCP 配置，再装配 Pi 和事件转发。会话组合入口同时装配 Pi、定时任务服务及其执行器。启动层将 Magpie 持有的同一模型服务交给 Pi、伴侣服务、Coding Room 和集成就绪检查。Work 定时工具使用该任务服务，Cron 执行器直接使用同一个 Pi 实例。模型路由和 Channel 恢复后启用已保存的日程。Magpie 在创建时接收本地推理的模型读取入口。本地推理持有并关闭 llama.cpp 编排实例，Magpie 持有模型路由与组织网关。

Windows 在创建首个窗口前异步检查开始菜单。只清理声明了本应用 AUMID、且指向遗留 Electron 可执行文件的快捷方式，开发版随后更新自己的快捷方式。

Channel 边车由主进程拥有。已完成消息的重投递回执随主库初始化，Channel 启停只管理进程和连接。退出和重新配置共用同一停机操作，等待子进程退出，宽限超时后强制终止。

伴侣聊天按宠物实例隔离 Pi 会话。首轮和后续轮次都从 `continueSession` 进入无工具的聊天模式，由 Pi 按需创建或恢复原生会话。主库保存气泡历史和请求回执，包括尚未送入 Pi 的已受理请求。重启时这些未完成的回复记为中断。Pi JSONL 保存模型续聊用的结构化上下文。伴侣档案负责活动身份、人格和外观。桌宠窗口呈现外观并管理运动与提醒，伴侣窗口呈现聊天。两个窗口订阅同一档案的变更。Windows 桌宠观察器负责停止传感器，应用退出等待所有尚未退出的传感器，包括所属窗口已经关闭的进程。旧版伴侣 SQLite 文件原地保留。

Coding Room 的内置 Agent 也经 Pi 执行。用户在 Coding Room 选用外部 Agent 时，由该工作区的执行通道通过 ACP 管理所选外部进程及会话。这条入口承载现有的外部 Agent 功能。

`CodingRoomService` 持有应用入口和事件出口。`CodingRoomState` 管理工作区快照、通道索引和驱动会话，`CodingRoomTurnExecution` 管理回合和待发送消息队列，两者由入口显式装配。

| 模块 | 角色 |
| --- | --- |
| `piRuntimeAdapter.ts` | 会话启动/续聊、工具与权限、流事件出口 |
| `piRuntimeAdapterHost.ts` 等 `piRuntime*` | 会话生命周期、资源加载、记忆注入、恢复 |
| `piWorkLoop.ts` / `piTurnWorkflow.ts` | 轮次与工作流 |
| `piPythonTools.ts` | 托管 Python 工具 |
| `piSkillScriptTool.ts` | `run_skill_script` |
| `mcpPiAdapter.ts` | MCP 接入 Pi |

Cowork 数据流（不含流式细节）：

```text
App.tsx → coworkService.init() → IPC 加载配置/会话 → 流监听
startSession() → IPC → PiRuntimeAdapter → 流事件 → Redux
```

流式 IPC/渲染说明见 [streaming.md](streaming.md)（Pi 事件翻译为增量 UIMessageChunk，主进程仅 coalescer 一处合并，渲染端 rAF 批处理进 `LiveTextStore`，经 `ConversationStage` / 常驻 `<StageComposer>`、懒加载 `SessionStage`、`projectSessionToTurns` 回合投影、`AssistantTextPartView`/`ThinkingPartView` 隔离订阅与 Streamdown 2.7 / `@tanstack/react-virtual` 增量渲染；全文快照仅限异常路径与终态）。权限请求经 `CoworkPermissionModal` 回传引擎。

Work 回合的存储归属如下。

| 记录 | 职责 |
| --- | --- |
| `cowork_sessions` / `cowork_messages` | 会话列表和用户可见消息，由 CoworkStore 提供 |
| Pi JSONL | Pi 恢复模型上下文时使用的结构化历史，按会话生命周期隔离 |
| `workbench_tasks` / `workbench_runs` / `workbench_run_events` | 任务尝试、结算、审批和测量。最终回复从结算事件传给记忆提炼 |
| `artifact_ledger` | 会话或 Coding Room 执行通道的产物台账，用于展示、检查点范围判定，以及按运行 ID 提供记忆证据 |
| `memory_checkpoints`、记忆归属与 outbox | 检查点正文、原生会话身份和 Engram 同步状态。会话关闭摘要和项目归属由 `memory_session_finalizations` 持有，关闭投递项只保存会话标识 |
| `zhiyuan_activity_runs` | 渠道活动快照及定时任务的展示信息。定时任务活动的状态从 Cron 运行记录读取 |
| `channel_inbox` | 渠道成功回执，按平台、账号和消息 ID 去重。失败或中断的请求在传输侧重投时再次执行 |

新数据库只创建产物台账。已有数据库中的 `workbench_artifacts` 记录继续供运行审计读取，并随对应会话删除。Cowork 配置在 `cowork_config`，应用 KV 在 `kv`。

主库由启动服务统一打开、发布和关闭。应用退出先等待写入收尾，启动超时或退出后才打开的连接由启动服务关闭。主库打开后，在同一个事务中把遗留的运行中会话恢复为空闲，取消上次进程遗留的 Workbench 排队与运行记录（含桌宠提交的任务），并让这些运行的待决审批过期。已开始但没有结果的工具操作标记为待核对，已受理但未完成的伴侣聊天回执标记为未回复。Cron 的中断运行、任务运行状态和活动流投影也在这个事务中更新。随后应用才启动备份、渠道接收、调度和窗口。桌宠凭原始回执关联任务与运行，显示状态由 Workbench 提供。Cron 历史按本地日期和状态在 SQLite 筛选并分页。

## 托管 Python

随包 CPython / uv 与 `resources/skill-python/layers/shared` 提供离线办公/PDF 依赖基线。独立 Runner 在 `userData/python-runtime/workspaces-v2/<sha256(realpath)>/` 管理每个工作区的版本化环境；首次复制基线，安装时从当前环境复制独立候选，解析、依赖检查和冻结成功后原子切换 `current.json`。失败保留当前环境；旧布局原地保留且不读取。新增包接受名称或版本范围，由安装器锁定版本，只使用兼容 wheel。工作区和 Skill 依赖安装共用索引策略与 uv 缓存。

`python_execute` 与 Python `run_skill_script` 共用 `PythonRuntimeService` 和同一个工作区解释器；包装脚本与长驻 Skill 进程先调用 `prepare`。Runner 核对 Skill requirements 指纹、按需 delta lock 的 SHA-256 与大下载确认，manifest 过期直接失败，不走临时 `uv run` 旁路。复制、扫描、哈希、包管理与脚本执行均在 Runner 内，主进程负责排队与生命周期；执行具有用户的文件权限。模块、进程清理和集成验证见 [托管 Python 运行时](../../src/main/pythonRuntime/README.md)。

## 本地推理（llama.cpp）

服务级选项控制 `llama-server` 进程；模型级选项在加载/运行时传入。类型与共享常量：`src/shared/llamacpp/`。

应用选定的 Router 或 daemon 持有推理进程，并负责启动、加载、卸载与退出清理。服务状态和运行模型列表只查询现有实例，模型库列表直接扫描当前 GGUF 目录。显式启动和加载模型可以启动服务。更换模型目录由当前实例重启，停机时只保存配置。Router 按解析后的模型目录保存独立的生成预设。

两种编排共用 `llamacppModelGateway.ts` 管理回环监听、端口重绑与关闭。退出时分别跟踪已接纳请求的排空和进程退出。守护进程控制凭证在发起停机时读取，后续控制请求脱离主库。Magpie 负责模型路由与局域网入口。

2026-10 起超大单文件已按职责拆分（#1069 / #1116），**对外 import 路径不变**（barrel re-export）：

### `llamacppManager/`

| 文件 | 职责 |
| --- | --- |
| `manager.ts` | 模型库读取、安装与导入，后端包管理，以及对选定可执行文件的能力探测 |
| `fileUtils.ts` | INI 与路径工具 |

### `llamacppBackendManager/`

| 文件 | 职责 |
| --- | --- |
| `paths.ts` | 安装路径与目录布局 |
| `catalog.ts` | 可用 backend 目录 |
| `install.ts` | 下载与安装 |
| `support.ts` | 平台能力与探测 |

### `ipcHandlers/llamacpp/`

| 文件 | 职责 |
| --- | --- |
| `helpers.ts` | IPC 共享辅助 |
| `config.ts` | 服务/模型偏好持久化 |
| `registerHandlers.ts` | `window.electron.llamacpp` 方法注册 |

Vitest 直接运行 `llamacppManager/` 下的运行时、模型库、下载和导入测试。

### 模型市场目录

`resources/model-catalog.sqlite` 是预填充的发布输入，由 Electron Builder 复制到应用资源目录。首次使用直接读取随包版本。本地搜索、详情和安装元数据解析不依赖云目录，模型权重按文件版本从 ModelScope 下载并校验。打包前后均校验至少 100 个不同仓库，数据库大小不超过 100 MB。

更新随包版本时，先取得上游发布快照 JSON，再运行 `bun run scripts/build-model-catalog.cjs /path/to/current-snapshot.json`。检查 `PRAGMA integrity_check` 和模型数量后提交更新后的数据库。上游使用 `scripts/publish-model-catalog.cjs` 生成完整快照和可选增量，再发布到 `/v1/catalog/feed`。

桌面端完成本地查询后独立检查更新，搜索响应无需等待网络。校验通过后对暂存 SQLite 应用更新并原子切换指针。当前会话固定目录版本以保证分页和安装一致，下一次启动启用新版本。增量基线不匹配时下载完整快照，网络或校验失败时保留上一版。

## IPC 与渲染层约定

### Preload 表面

契约类型：`src/renderer/types/electron.d.ts`。实现：`src/main/preload.ts` + 各 `ipcHandlers/*`。

### Zod IPC 契约

Skills/MCP/Marketplace、AppSystem/Providers、CodingAgent/IM/自动化（定时任务+Activity）/Memory/Artifacts，以及 Cowork（sessions、queue、config、workspace、权限、run snapshot、stream 恢复）、Workbench Task、Todo 走 `src/shared/ipc/contract.ts` 的 `defineIpcContract`（channel + zod args 元组 + result），单一事实来源。主进程用 `handleIpcContract`（`src/main/ipc/`）注册并运行时校验入参（失败即以含 channel 与 zod 摘要的错误拒绝，不调实现）；渲染层类型与 preload invoker 均从契约派生（`IpcContractApi` / `createIpcInvokers`）。沙箱 preload 不能引 zod，因此每个契约配一个 zod-free 的 `*.channels.ts` 通道映射（`IpcContractChannels` 锁定与契约一致）。新域 IPC 优先套用此模式。

跨多个注册文件的契约（如 appSystem 覆盖 store/dialog/shell/appUpdate 等）按文件用 `handleIpcContractSubset` 注册各自子集；实现收到的 event 是完整 `IpcMainInvokeEvent`（`IpcContractHandlers` 的 event 参数按注册侧绑定）。Cowork 契约则按注册模块拆为多个子契约（`coworkContract.ts` 内 `coworkSession*` / `coworkQueue*` / `coworkConfig*` / `workspaceContract` 等）。无论哪种方式，每个 channel 只能注册一次——重复注册会在启动时抛 "Attempted to register a second handler"。

渲染端单向事件使用 `listenToWindowIpcEvent`。它核对所属窗口和主帧，再验证参数元组，并返回注销函数。桌宠沙箱 preload 从事件契约取得 TypeScript 类型，通过通道常量发送事件。

伴侣聊天、任务和档案的 IPC 由伴侣气泡的主帧调用，相关状态推送也由气泡接收。主窗口的伴侣桥只订阅打开工作台的导航事件，工作台会话继续使用 Cowork IPC。

### Toast

- **唯一派发入口：** `showAppToast`（`src/renderer/services/toastNotification.ts`），经 `appToast.ts` re-export；错误场景用 `showAppError`。
- **禁止**在组件/服务中直接 `window.dispatchEvent(new CustomEvent('app:showToast', …))` 或等价字符串派发。
- CI：`scripts/ci/check-app-show-toast-dispatch.mjs`（oxc-parser AST），挂入 `bun run lint`。

### 两套「store」

| 模块 | 含义 |
| --- | --- |
| `src/renderer/services/store.ts` | 主进程 SQLite KV 的异步 IPC 适配器（`window.electron.store`） |
| `src/renderer/store/` | Redux 同步 UI 状态 |

二者语义隔离，勿混用命名或职责。

## 代码规范与 CI 门禁

| 规则 | 依据 |
| --- | --- |
| 单文件硬上限 **1000** 行，新文件目标 ≤800 | `scripts/ci/check-source-line-limit.mjs` + `scripts/ci/source-line-baseline.json` |
| baseline `caps` **只能缩小**：文件降至 ≤1000 行后须从 baseline 删除；不得提高 cap 或 limit | 同上 |
| 未使用导出/依赖 | `bun run knip`（亦在 `lint` job 内） |
| Toast 派发 | 见上节 |

推送 PR 前建议（与 [CONTRIBUTING.md](../../CONTRIBUTING.md) 一致）：

```bash
bun run build
bun run lint      # 含 Knip、行数、toast 检查、theme
bun run knip      # 可单独复跑
bun run test
bun run format:check
```

必需 GitHub 检查：**`ci-gate`**（汇总 baseline 与路径归属 job）。PR 说明见 [DEVOPS.md](../../DEVOPS.md)。

## 发版

仅两条社区 OTA 路径（#1040 后）：

1. **`release.yml`**：在 `main` 打 `v*` tag → 构建签名 → R2 **beta** + GitHub pre-release。
2. **`promote.yml`**：手动 `workflow_dispatch`，输入已有 beta 的 version（无 `v` 前缀）→ **不重建**，指针升 **stable**；回滚对旧 version 再 promote（`ALLOW_STABLE_ROLLBACK`）。

细节：[RELEASING.md](../../RELEASING.md)。已删除的 workflow（如 `build-platforms.yml`、`online-update-release.yml`、`release-candidate.yml`、daily 自动 stable）**不再使用**，文档与脚本勿再引用。

## 相关文档

- [AGENTS.md](../../AGENTS.md) — agent 与贡献者完整规则（含前端 P0、记忆、Python 运行时）
- [DESIGN.md](../../DESIGN.md) — 视觉规范
- [.github/CI.md](../../.github/CI.md) — CI 路径归属与 expensive checks
- [src/renderer/theme/README.md](../../src/renderer/theme/README.md) — 主题系统
- [src/main/pythonRuntime/README.md](../../src/main/pythonRuntime/README.md) — 托管 Python
