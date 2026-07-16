# Workspace 会话模型重构说明

本文说明 Cowork 会话从“跟随 Agent”调整为“跟随 Workspace”后的实现、数据迁移策略，以及专家角色提示词与普通会话提示词的隔离方式。

## 1. 重构目标

### 1.1 目标

- 使用 Workspace 作为会话列表、工作目录和侧栏分组的主键。
- 保留 Agent 作为会话创建时的角色快照，不让 Agent 切换改变历史会话。
- 让同一个 Workspace 可以创建多个不同 Agent 角色的会话。
- 让恢复旧会话时使用会话自身保存的工作目录、模型和 system prompt。
- 兼容已有 SQLite 数据和历史会话，不要求用户手工迁移。

### 1.2 非目标

- 本次重构不删除 Agent 表、Agent 配置页或 `agent_id` 字段。
- 本次重构不改变 IM/邮件通道的 Agent 绑定语义。
- 本次重构不把所有 OpenClaw 历史文件立即迁移到用户 Workspace。

## 2. 核心概念

### Workspace

Workspace 表示用户选择的项目目录，是 Cowork 会话执行工具时使用的工作目录。Workspace 使用规范化后的绝对路径生成稳定 ID：

```text
workspaceId = workspace-<sha256(normalizedPath)[0:24]>
```

同一路径在不同会话中得到同一个 Workspace。任务容器目录 `.rongxinai-tasks` 会在归一化时去除，避免同一个项目被显示成多个 Workspace。

### Agent

Agent 表示角色、身份、模型和技能配置。它不再决定 Cowork 会话属于哪个项目，也不再决定 Cowork 会话的工作目录。

创建会话时，系统保存：

- `agent_id`：创建会话时的 Agent 角色快照引用。
- `system_prompt`：创建会话时已经合并好的角色和普通会话 prompt。
- `model_override`：创建会话时的模型快照。
- `cwd`：创建会话时 Workspace 的实际工作目录。
- `workspace_id`：会话的主归属。

因此，Agent 可以继续被编辑或切换，但不会改写已经存在的会话语义。

## 3. SQLite 数据模型

新增 `workspaces` 表：

| 字段         | 说明                        |
| ------------ | --------------------------- |
| `id`         | 由规范化路径计算出的稳定 ID |
| `name`       | 侧栏显示名称，默认取目录名  |
| `path`       | 规范化后的绝对路径，唯一    |
| `created_at` | 首次登记时间                |
| `updated_at` | 最近使用或重命名时间        |

`cowork_sessions` 新增：

```sql
workspace_id TEXT
```

同时创建 `idx_cowork_sessions_workspace_id` 索引。查询会话列表、统计数量和计算置顶顺序时，Workspace 优先于 Agent。

## 4. 历史数据迁移

SQLite 初始化时会执行兼容迁移：

1. 如果 `cowork_sessions.workspace_id` 不存在，先添加可空字段。
2. 查询所有没有 `workspace_id` 的历史会话。
3. 使用历史会话的 `cwd` 生成或复用 Workspace。
4. 将生成的 Workspace ID 回填到对应会话。
5. 如果历史 `cwd` 为空，使用默认项目目录作为迁移兜底路径。

迁移是幂等的。已完成回填的会话不会重复生成 Workspace，原有 `cwd`、消息和 Agent 信息不会被删除。

## 5. Expert prompt 与普通会话隔离

这是本次重构的关键边界。

### 5.1 新建会话

新建 Cowork 会话时，主进程根据请求中的 `agentId` 读取 Agent 的角色 prompt，并与普通 Cowork 配置合并：

```text
会话 system prompt
  = 产品/运行时基础规则
  + 定时任务规则
  + Agent 角色 prompt（仅当前 Agent）
  + 普通 Cowork system prompt
  + 当前技能上下文
```

合并后的结果写入 `cowork_sessions.system_prompt`。这一步只发生在创建会话时。

### 5.2 普通会话不会读取专家文件

普通 Cowork 会话不会因为当前 Workspace、当前 Agent 或共享目录中存在专家文件，就自动加载其他 Agent 的 `SOUL.md`、身份文件或角色 prompt。

Agent 的 OpenClaw 专属文件仍可由 OpenClaw 配置同步逻辑维护，用于对应的 OpenClaw Agent/IM 路径；Cowork 会话使用自己的 session prompt 快照作为权威来源。

### 5.3 继续和恢复会话

继续会话时，主进程优先使用当前 session 已保存的：

- `system_prompt`
- `cwd`
- `agent_id`
- `model_override`

不会重新读取当前选中的 Agent prompt，也不会用当前 Cowork 配置覆盖历史 prompt。对于未在内存中保持活动状态的 Pi 会话，恢复逻辑会使用保存的 `cwd` 创建运行时，并将历史消息作为上下文恢复。

这保证了以下行为：

| 操作                   | 新会话         | 已有会话                    |
| ---------------------- | -------------- | --------------------------- |
| 切换 Agent             | 影响后续新会话 | 不改变角色                  |
| 修改 Agent prompt      | 影响后续新会话 | 不改变已保存 prompt         |
| 切换 Workspace         | 影响后续新会话 | 通过会话自身 Workspace 恢复 |
| 修改全局 Cowork prompt | 影响后续新会话 | 不覆盖历史 prompt           |

## 6. 运行时工作目录

Pi 运行时的 `cwd` 来源为 session 的 `workspaceRoot`，而不是 Agent 的 `workingDirectory`：

```text
Workspace.path
  -> main: resolveTaskWorkingDirectory()
  -> session.cwd
  -> Pi startSession({ workspaceRoot: session.cwd })
```

Windows 驱动器根目录仍然被拒绝作为工作目录，避免工具创建目录时触发系统权限错误。用户需要选择驱动器下的具体目录。

OpenClaw IM/邮件通道仍保留原有 Agent 默认工作目录解析，因为那是通道绑定场景，不属于 Cowork Workspace 会话列表的主归属逻辑。

## 7. IPC 与 Renderer 流程

### Workspace IPC

Workspace IPC 常量位于 `src/shared/workspace/constants.ts`：

| IPC                       | 用途                       |
| ------------------------- | -------------------------- |
| `cowork:workspace:list`   | 获取 Workspace 列表        |
| `cowork:workspace:ensure` | 按目录创建或获取 Workspace |
| `cowork:workspace:rename` | 修改 Workspace 显示名称    |

会话 IPC 的 start/list 请求增加 `workspaceId`。当 Workspace ID 存在时，主进程以 Workspace 记录中的路径为准，不信任与其不一致的前端 `cwd`。

### Renderer 状态

- `workspaceSlice` 保存 Workspace 列表和当前 Workspace。
- `workspaceService` 负责加载、选择、创建和重命名 Workspace。
- `CoworkService.loadSessions()` 默认按当前 Workspace 查询。
- 侧栏使用 `Workspace -> Task` 树，任务节点仍展示 session 的 Agent 快照信息，但不再按 Agent 分组。
- 加载历史 session 时，同时恢复 Workspace 和 Agent 的 UI 选择状态。

## 8. 兼容性说明

- `agent_id` 保留，历史 Agent 相关数据和 Agent 管理功能继续可用。
- `agent.working_directory` 保留，供 Agent/IM 兼容路径使用；Cowork 新会话不再使用它作为主工作目录来源。
- 旧协议名、运行时存储名和历史数据库文件名不在本次重构中修改。
- 旧会话没有 Workspace ID 时，通过 `cwd` 自动回填。
- OpenClaw 的临时历史会话返回空 `workspaceId`，因为它们不是本地 Cowork SQLite 会话。

## 9. 相关代码

- Workspace 类型与 IPC：`src/shared/workspace/`
- Workspace 路径工具：`src/main/workspaceUtils.ts`
- SQLite schema 与迁移：`src/main/sqliteStore.ts`
- 会话和 Workspace CRUD：`src/main/coworkStore.ts`
- Cowork IPC：`src/main/main.ts`、`src/main/preload.ts`
- Renderer Workspace 状态：`src/renderer/store/slices/workspaceSlice.ts`
- Renderer Workspace 服务：`src/renderer/services/workspace.ts`
- Workspace 侧栏：`src/renderer/components/agentSidebar/`
- Pi 会话恢复：`src/main/libs/agentEngine/piRuntimeAdapter.ts`

## 10. 验证清单

提交前应执行：

```bash
npm run lint
npm test
npm run build
npx tsc -p electron-tsconfig.json --noEmit
npx tsc -p tsconfig.json --noEmit
```

手工验证重点：

1. 选择 Workspace A 创建普通会话。
2. 切换到另一个 Agent，再回到原会话，确认角色和工作目录不变。
3. 修改 Agent prompt 后继续旧会话，确认旧 prompt 不被替换。
4. 选择 Workspace B 创建会话，确认侧栏按 Workspace 分组。
5. 使用旧数据库启动应用，确认历史会话自动出现于对应 Workspace。
6. 关闭应用后重新打开，确认 Workspace、会话和 Agent 快照可以恢复。

## 11. 会话级专家架构

本节补充当前版本的会话级专家实现。专家属于会话上下文，不属于 Workspace 配置；Workspace 只负责文件工具的工作目录。同一个 Workspace 内的不同会话可以选择不同专家，一个会话也可以同时选择多个专家。

### 11.1 数据模型

新增 `cowork_session_experts` 表保存专家快照，包含会话 ID、专家 ID、专家包 ID、显示名称、来源、`prompt_snapshot`、技能 ID、能力策略、内容哈希和创建时间。会话删除时关系级联删除；删除或更新专家不会删除历史会话，也不会改写已经保存的提示词。

`agents` 表继续保留，用于兼容旧 Agent、IM 绑定和历史数据。Cowork 新会话通过 `expertIds` 选择专家，Main 进程只接受专家 ID，校验后生成快照，不信任 Renderer 传入的 MD 内容或文件路径。

### 11.2 用户流程

1. 用户在输入框顶部打开专家选择器。
2. 通过 Popover 和 Command 搜索并多选已安装专家。
3. 选中的专家以 Badge 显示在输入框内。
4. 首次发送时，专家 ID 与会话一起写入 SQLite。
5. 关闭并重新打开会话时，从 `cowork_session_experts` 恢复专家名称和选择状态。
6. 继续会话时，Main 根据快照恢复提示词和技能列表。

运行中的 Pi 会话不能通过 `session.prompt()` 动态替换 system prompt。当前版本允许保存新的专家绑定，但完整提示词会在 runtime 会话重建后生效；展会演示应在首次发送前完成选择。

### 11.3 提示词和技能隔离

普通会话不读取其他专家的 MD 文件。专家会话的提示词由 Main 统一拼装：

```text
产品和运行时基础规则
+ 定时任务规则
+ Cowork 配置提示词
+ 当前会话的专家 prompt_snapshot
+ 当前会话选中的技能上下文
```

Pi runtime 通过每个会话独立的 `DefaultResourceLoader({ systemPromptOverride })` 接收提示词，不再把每个会话的提示词写入共享的 `<workspace>/.pi/SYSTEM.md` 或 `~/.pi/agent/SYSTEM.md`。技能只格式化当前会话需要的技能，避免把全部用户技能注入每个会话。

升级时需要注意：旧版本可能已经在 Workspace 留下 `.pi/SYSTEM.md`。首次演示应使用干净 Workspace，避免旧文件被 Pi ResourceLoader 自动加载并污染新会话。

### 11.4 Workspace 和 Team 专家

主会话和 Team 子代理都应使用父会话的 `workspaceRoot`。Team 成员仍通过专家包导入流程同步到 Pi 专家目录，当前版本按专家包前缀筛选成员；后续应改为按会话快照和包哈希筛选，避免全局成员目录成为隐式依赖。

### 11.5 安全边界

- 专家包中的 `agents`、`skills` 路径必须经过 `realpath` 包含检查。
- 拒绝通过符号链接访问专家包目录外的文件。
- 专家 MD 和技能是模型指令，不是安全边界；`local` 模式仍可能访问本地工具。
- 当前 MCP manifest 仍是全局能力，`capability_policy` 已保存但尚未强制过滤 MCP 工具，不应把当前版本当作完整沙箱。
- 专家导入应在验证全部路径后再复制技能和同步 Pi 文件，避免损坏或恶意包产生半成品副作用。

### 11.6 兼容、性能和回滚

- 老会话没有专家关系时继续使用已有 `system_prompt`、`cwd`、`agent_id` 和模型快照。
- Agent 切换不会改写已有会话的专家快照。
- SQLite 通过会话 ID 和创建时间索引读取专家绑定，不影响 Workspace 会话分页。
- 专家提示词和技能清单只在创建 Pi session 时拼接；Team 子代理目前每次委派都会创建独立 Pi session，并有 120 秒超时。
- 回滚代码时可以保留 `cowork_session_experts` 表，旧版本会忽略该表；旧版本不会显示会话专家。

### 11.7 验证和展会演示清单

自动化检查：

```bash
npm run build:tsc
npm run lint
npm test
```

手工检查：

1. 同一个 Workspace 创建两个会话，分别选择不同专家，确认提示词不串扰。
2. 选择多个专家并发送消息，关闭后重新打开，确认 Badge 和专家名称仍存在。
3. 修改或删除专家定义，确认既有会话仍使用快照。
4. 使用包含 `../` 或符号链接的专家包，确认导入失败且不复制包外文件。
5. Team 专家委派成员，确认成员 cwd 等于父会话 Workspace。
6. 使用旧数据库启动，确认历史会话和消息仍可见。

展会应使用全新 Workspace，提前安装专家、配置模型和登录态，并预热 runtime。建议演示“输入区选择专家 -> 首次发送 -> 展示 Badge -> 重启后恢复会话”。当前版本不建议现场演示运行中会话动态替换专家、高权限 MCP 或 OpenClaw 网关故障恢复。

## 12. 本次 MR 增量修复

### 12.1 会话历史分页与滚动加载

会话首次打开时后端仍只读取最近一页消息，默认页大小为 30 条，以控制首次 IPC 传输和首屏渲染成本。消息区滚动到顶部后，Renderer 调用 `getSessionMessages` 分页读取更早消息，并通过新增内容的高度差补偿 `scrollTop`，保证用户当前阅读位置不跳动。

如果首屏消息不足以产生滚动条，前端会自动继续请求更早页面，直到历史内容能够滚动或已经到达会话开头。该机制不删除、不覆盖 SQLite 中的历史消息。

### 12.2 中间过程统一折叠

一个会话 turn 中，最后一个 assistant answer 单独显示；其之前的中间 answer、思考内容和工具调用统一放在“中间过程”折叠区中：

- 流式执行期间中间过程保持展开，方便观察实时进度。
- final answer 生成后中间过程自动收起。
- 用户展开中间过程时，工具卡片仍保持工具自身的折叠状态，不会一次性展开工具输入和输出。
- 思考状态以消息分组状态为准；后续 answer 已出现时，即使旧 metadata 仍标记 `isStreaming`，界面也显示“思考完成”。

### 12.3 系统语言与全局提示词

`resources/SYSTEM_PROMPT.md` 要求回复语言优先跟随用户当前系统语言或应用语言设置：

1. 不因模型默认语言、专家套件或技能提示词自行切换语言。
2. 无法读取系统语言时，跟随用户当前消息语言。
3. 用户明确指定语言时，遵循用户的明确要求。
4. Main 进程会根据当前应用语言，在每次新建、继续或切换专家时注入带标记的运行时语言指令；切换应用语言后，旧会话继续执行也会使用最新语言指令。

### 12.4 联网搜索与 Playwright

联网搜索优先使用 RongxinAI `web-search` skill。该 skill 通过 Playwright 控制隔离的本地 Chrome，默认无头搜索，受阻时回退到可见浏览器。已知 URL 优先使用 `web_fetch`，需要登录、表单或复杂动态交互时才使用 `browser`。

Windows 执行搜索脚本必须使用 Git Bash/PortableGit，不能直接使用没有 Linux 发行版的 `C:\Windows\System32\bash.exe`。Playwright CLI 操作遵循 `open -> snapshot -> 使用最新 ref -> 页面变化后重新 snapshot` 的流程。

### 12.5 Markdown 代码高亮容错

流式代码围栏可能在语言标识尚未生成完整时短暂出现 `pyt`，随后才变为 `python`。代码块渲染器现在会：

- 将 `pyt` 归一化为 `python`。
- 对未知语言跳过 Shiki 加载，按纯文本显示，避免前端异常。
- 保证头部显示语言和实际 Shiki 高亮语言使用同一个归一化结果。

### 12.6 本次验证

已通过：

- `npm.cmd run build:tsc`
- 相关 Renderer、ai-elements 和 i18n 文件 ESLint
- `git diff --check`

完整 Vitest 在当前 Windows 宿主机上被 `better-sqlite3` 原生文件锁定阻断，错误为 `EBUSY/EPERM`，未出现测试断言失败。该环境问题需要释放占用 `node_modules/better-sqlite3/build/Release/better_sqlite3.node` 的进程后再执行。

### 12.7 MR 交付与合并

- 源分支：`feat/session-level-experts`。
- 目标分支：`dev`，提交基线为远端最新 `origin/dev`。
- 提交内容包含历史分页、中间过程折叠、系统语言约束、联网搜索说明、代码高亮容错和本文档。
- 合并前应确认 TypeScript、Lint 和差异检查通过；Vitest 需在释放 `better-sqlite3` 文件锁后补跑。
- 合并后建议重新打开已有会话，验证历史消息可持续向上加载，且 final answer 前的中间过程不会展开工具卡片。

### 12.8 产品名称与后端路径兼容

- 设置“关于”、窗口标题、托盘菜单、安装包、可执行文件、安装器和系统应用注册名统一显示为“知远”。
- `appId`、`rongxinai` 协议 scheme、SQLite 文件名和历史兼容标识保持不变，避免破坏已有安装、协议唤起和数据读取。
- Windows、macOS 和 Linux 的打包配置只调整产品显示名；安装器仍兼容停止旧版 `RongxinAI.exe` 进程。
- `%APPDATA%\\RongxinAI` 继续作为首选用户数据目录，OpenClaw 状态、SQLite、技能、模型、日志和更新文件不会迁移到“知远”目录。
- 如果设备只有旧版 `%APPDATA%\\LobsterAI` 数据目录且没有 `RongxinAI` 目录，启动时仍沿用旧目录，保证历史数据可见。
