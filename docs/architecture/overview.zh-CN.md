# 架构概览

知远智能体 (ZhiYuan Agent) 是 Electron + React 的本地优先桌面 Agent。渲染进程只做 UI 与编排；主进程持有 SQLite、Pi 执行内核、本地推理进程与 IPC。

## 进程与信任边界

| 进程 | 路径 | 职责 |
| --- | --- | --- |
| Main | `src/main/` | 窗口、持久化、Pi 运行时、llama.cpp 生命周期、Skill/MCP、IPC handler |
| Preload | `src/main/preload.ts` | `contextBridge` → `window.electron`（contextIsolation 开、nodeIntegration 关、sandbox 开） |
| Renderer | `src/renderer/` | React UI；业务逻辑在 `src/renderer/services/`，禁止直接访问 Node/Electron |
| Channel/Cron 传输 | `src/main/libs/ccConnect*`、`src/main/im/` | 只搬运渠道事件与 cron 触发，**不**执行 Agent、不持有任务状态 |

主进程在 IPC/agent 热路径上不得做同步整盘扫描、大文件读/哈希、重解析等 CPU 密集工作；可分离部分进 `worker_threads`（池 ≤2、可取消）。详见 [AGENTS.md](../../AGENTS.md)「主进程 / Worker 边界」。

## 目录导览

### 主进程

| 路径 | 说明 |
| --- | --- |
| `src/main/main.ts` | 应用入口、窗口与生命周期 |
| `src/main/sqliteStore.ts` | `userData/zhiyuan.sqlite`（better-sqlite3） |
| `src/main/ipcHandlers/` | IPC 注册；本地推理见 `ipcHandlers/llamacpp/` |
| `src/main/libs/agentEngine/` | **Pi 唯一执行内核**（见下节） |
| `src/main/libs/llamacppManager.ts` | llama.cpp 编排 barrel（实现于 `llamacppManager/`） |
| `src/main/libs/llamacppBackendManager.ts` | 后端/runtime 安装 barrel（实现于 `llamacppBackendManager/`） |
| `src/main/skillManager.ts` | 内置 Skill 管理 |
| `src/main/pythonRuntime/` | 工作区隔离的托管 Python（`python_execute` / `python_install`） |
| `src/main/memory/` | Engram 投影与 `memory` 工具 |
| `src/shared/llamacpp/` | 主/渲染共享的 llama.cpp 类型与常量 |

### 渲染进程

| 路径 | 说明 |
| --- | --- |
| `src/renderer/App.tsx` | 壳层、Cowork 初始化 |
| `src/renderer/services/cowork.ts` | Cowork IPC 与流订阅 |
| `src/renderer/services/` | API、toast、持久化 KV 适配器等 |
| `src/renderer/store/` | **Redux** 内存状态（与会话 UI 同步） |
| `src/renderer/components/cowork/` | Work 主界面 |
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

**Pi First：** `src/main/libs/agentEngine/piRuntimeAdapter.ts` 是 Work / Chat / Channel / Cron 的**唯一**执行内核。新能力优先用 Pi 原生机制，不在 harness 层重造。

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

流式 IPC/渲染说明见 [streaming.md](streaming.md)（Pi 事件翻译为增量 UIMessageChunk，主进程仅 coalescer 一处合并，渲染端 rAF 批处理进 LiveTextStore；全文快照仅限异常路径与终态）。权限请求经 `CoworkPermissionModal` 回传引擎。

存储：`cowork_sessions` / `cowork_messages`；Cowork 配置 `cowork_config`；应用 KV 在 SQLite `kv` 表。

## 本地推理（llama.cpp）

服务级选项控制 `llama-server` 进程；模型级选项在加载/运行时传入。类型与共享常量：`src/shared/llamacpp/`。

2026-10 起超大单文件已按职责拆分（#1069 / #1116），**对外 import 路径不变**（barrel re-export）：

### `llamacppManager/`

| 文件 | 职责 |
| --- | --- |
| `core.ts` | 基类与共享状态 |
| `backendOps.ts` | 后端绑定与可执行文件 |
| `serviceLifecycle.ts` | 服务启停 |
| `modelOps.ts` | 模型加载/卸载（`LlamaCppManager` 导出类） |
| `types.ts` / `fileUtils.ts` | 类型与 INI/路径工具 |

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

单测按域拆分：`llamacppManager/serve.test.ts`、`models.test.ts`、`install.test.ts`；根 `llamacppManager.test.ts` 仅聚合 side-effect import。

## IPC 与渲染层约定

### Preload 表面

契约类型：`src/renderer/types/electron.d.ts`。实现：`src/main/preload.ts` + 各 `ipcHandlers/*`。

### Zod IPC 契约

Skills/MCP/Marketplace、AppSystem/Providers、CodingAgent/IM/自动化（定时任务+Activity）/Memory/Artifacts，以及 Cowork（sessions、queue、config、workspace、导出/权限、run snapshot、stream 恢复）、Workbench Task、Todo 走 `src/shared/ipc/contract.ts` 的 `defineIpcContract`（channel + zod args 元组 + result），单一事实来源。主进程用 `handleIpcContract`（`src/main/ipc/`）注册并运行时校验入参（失败即以含 channel 与 zod 摘要的错误拒绝，不调实现）；渲染层类型与 preload invoker 均从契约派生（`IpcContractApi` / `createIpcInvokers`）。沙箱 preload 不能引 zod，因此每个契约配一个 zod-free 的 `*.channels.ts` 通道映射（`IpcContractChannels` 锁定与契约一致）。新域 IPC 优先套用此模式。

跨多个注册文件的契约（如 appSystem 覆盖 store/dialog/shell/appUpdate 等）按文件用 `handleIpcContractSubset` 注册各自子集；实现收到的 event 是完整 `IpcMainInvokeEvent`（`IpcContractHandlers` 的 event 参数按注册侧绑定）。Cowork 契约则按注册模块拆为多个子契约（`coworkContract.ts` 内 `coworkSession*` / `coworkQueue*` / `coworkConfig*` / `coworkExport*` / `workspaceContract` 等）。无论哪种方式，每个 channel 只能注册一次——重复注册会在启动时抛 "Attempted to register a second handler"。

### `electronDomains`（实验性）

`src/renderer/services/electronDomains.ts` 将 preload 命名空间归纳为 5 域：`system`、`inference`、`agent`、`workspace`、`integration`。文件头标注 **experimental**；新代码**不强制**使用，可继续直接访问 `window.electron`。

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
