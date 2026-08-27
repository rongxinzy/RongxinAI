# ACP 编程模式设计

> 状态：工程实现完成，待真实 ACP 互操作验收
>
> 最后更新：2026-08-27
>
> 产品名称：知远智能体
>
> 入口：工作模式 → 编程

## 1. 文档目的

本文档定义知远智能体“编程”模式的产品边界、底层架构、Agent 发现与接入、多 Agent 协作、工作区安全、数据模型、UI 草图、实施阶段和验收标准。

后续实现应以本文档为基线。若实现过程中需要改变本文档中的协议边界、任务模型、写入隔离或交互语义，应先更新设计并重新评审，不应直接在代码中形成隐式新方案。

## 2. 一句话定义

“编程”是知远智能体内置的统一编程工作台：用户即使没有安装任何外部编程 Agent，也能使用内置的知远编程 Agent 完成任务；安装了 Claude Code、Codex、OpenCode 等 Agent 后，知远通过 ACP 发现、连接并组织它们协作，但不接管或注入这些 Agent 的模型与账号。

## 3. 已确认决策

### 3.1 产品入口

- 保留现有顶部“工作 / 对话”切换。
- “编程”是工作模式下的独立导航入口。
- 进入后，右侧主区域完整切换为独立的编程 Web-TUI。
- 进入编程模式时，应用主侧边栏下半区切换为编程专用的 Workspace / Session 树；退出后恢复工作模式项目树或对话会话记录。
- 编程工作台不再创建第二级任务侧边栏，主侧边栏是唯一导航层。
- 编程模式不作为 Cowork 对话中的 Artifact，也不嵌入 CLI TUI WebView。
- 切入和切出编程模式不应销毁原有工作、对话或 ACP 会话。

### 3.2 Agent 边界

- 内置知远编程 Agent 永远是第一方、一等能力。
- 外部 Agent 是可选增强项，不是使用编程模式的前置条件。
- 外部 Agent 通过 ACP 接入。
- 知远不向外部 Agent 注入自己的 API Key、Provider URL、模型名称、系统提示词或内置运行时配置。
- 每个外部 Agent 保留自己的账号、模型、配置、工具和记忆。
- 知远只使用 Agent 通过 ACP 明确声明的能力。

### 3.3 多 Agent 边界

- ACP 解决的是 Client 与 Agent 之间的连接，不直接定义 Agent 与 Agent 的协作协议。
- 多 Agent 协作由知远的 Coding Room Orchestrator 组织。
- 每个 Agent 拥有独立的连接、会话、状态、事件流和权限上下文。
- Agent 之间通过显式交接包协作，不共享隐式可变上下文。
- 第一版核心流程不得依赖私有 ACP 方法。

### 3.4 用户可见命名

- UI 显示“知远编程 Agent”，不显示内部运行时名称。
- ACP、运行时、适配器等实现细节只在诊断或开发文档中出现。
- 外部 Agent 使用其公开产品名称，例如 Claude Code、Codex、OpenCode。

## 4. 现有系统约束

当前代码中，`WorkMode` 只承载工作和对话两种 Cowork 执行语义：

- [`src/renderer/store/workMode/constants.ts`](../../src/renderer/store/workMode/constants.ts)
- [`src/renderer/components/cowork/CoworkView.tsx`](../../src/renderer/components/cowork/CoworkView.tsx)

`CoworkView` 会根据 WorkMode 清理不匹配的当前会话。因此不应把 `coding` 加入现有 `WorkMode`，否则会把编程导航与 Cowork 会话清理语义错误耦合。

推荐做法：

- Work/Chat 保持原样。
- 在工作导航下添加“编程”。
- 编程对应独立的 `MainView.Coding`。
- `App.tsx` 只做最小视图路由。
- 新业务逻辑全部放入独立模块。

相关入口：

- [`src/renderer/components/SidebarNavigationControls.tsx`](../../src/renderer/components/SidebarNavigationControls.tsx)
- [`src/renderer/components/Sidebar.tsx`](../../src/renderer/components/Sidebar.tsx)
- [`src/renderer/App.tsx`](../../src/renderer/App.tsx)

现有 Workbench Task 已定义 Task、Run、Approval 和 Artifact，可以复用其领域语义，但当前主进程中的部分恢复和验证路径仍然直接依赖 Cowork/Pi 会话，接入 ACP 前需要增加运行时路由层：

- [`src/shared/workbenchTask/constants.ts`](../../src/shared/workbenchTask/constants.ts)
- [`src/shared/workbenchTask/types.ts`](../../src/shared/workbenchTask/types.ts)
- [`src/main/workbenchTask/taskService.ts`](../../src/main/workbenchTask/taskService.ts)

## 5. 总体架构

```mermaid
flowchart LR
    UI[编程 Web-TUI] <-->|Typed IPC| IPC[编程 IPC Facade]

    IPC --> ROOM[Coding Room Orchestrator]
    IPC --> REG[Coding Agent Registry]

    ROOM --> DRIVER[CodingAgentDriver]
    DRIVER --> BUILTIN[BuiltinCodingDriver]
    DRIVER --> ACP[AcpCodingDriver]

    BUILTIN --> RUNTIME[内置 Agent Runtime]
    ACP --> SUP[ACP Connection Supervisor]
    SUP --> CLAUDE[Claude Code / Adapter]
    SUP --> CODEX[Codex / Adapter]
    SUP --> OPEN[OpenCode ACP]

    REG --> STATIC[内置 Agent 静态注册]
    REG --> DISCOVERY[外部 Agent Discovery / Probe]

    ROOM --> WORK[Workspace Broker]
    ROOM --> COLLAB[Collaboration Service]
    ROOM --> STORE[(SQLite + Event Store)]
    ROOM --> TASK[Task / Run / Approval / Artifact]

    WORK --> ROOT[用户工作区]
    WORK --> WT[Agent 专属 Git Worktree]
```

### 5.1 为什么不让内置运行时通过 ACP 自连接

ACP 是外部 Agent 的稳定集成边界，不必强制成为知远内部所有调用的唯一协议。

让内置运行时先实现 ACP Server，再由应用启动 ACP Client 连接自身，会带来额外的序列化、子进程生命周期、认证和错误恢复成本，却不增加用户价值。

正确的统一点是应用内部的 `CodingAgentDriver`：

```text
CodingAgentDriver
├── BuiltinCodingDriver
│   └── 直接调用现有内置 Agent Runtime
└── AcpCodingDriver
    └── 通过 ACP SDK 连接外部 Agent
```

如果未来需要让第三方编辑器连接知远编程 Agent，可以另行提供 ACP Server Adapter，但这不属于第一阶段。

## 6. CodingAgentDriver

### 6.1 职责

`CodingAgentDriver` 是编程工作台与具体 Agent 实现之间的内部边界，负责：

- 报告能力和认证状态。
- 创建、加载或恢复会话。
- 发送用户 Prompt。
- 接收规范化事件。
- 取消当前轮次。
- 响应权限请求。
- 释放会话和运行时资源。

概念接口：

```ts
interface CodingAgentDriver {
  getCapabilities(): Promise<CodingAgentCapabilities>;
  getAuthState(): Promise<CodingAgentAuthState>;
  authenticate(request: CodingAgentAuthRequest): Promise<void>;
  createSession(request: CreateCodingSessionRequest): Promise<CodingAgentSession>;
  loadSession(request: LoadCodingSessionRequest): Promise<CodingAgentSession>;
  prompt(request: CodingPromptRequest): AsyncIterable<CodingAgentEvent>;
  cancel(request: CancelCodingTurnRequest): Promise<void>;
  respondToPermission(response: CodingPermissionResponse): Promise<void>;
  disposeSession(sessionId: string): Promise<void>;
  dispose(): Promise<void>;
}
```

实现时，所有会重复比较的 kind、status、IPC channel 和 mode 必须定义在模块级 `constants.ts` 中，不能散落裸字符串。

### 6.2 统一事件

Driver 需要把内置运行时事件与 ACP `session/update` 归一化为统一领域事件：

- 消息与增量消息。
- 推理或状态说明。
- Agent Plan。
- Tool Call 及状态变化。
- 权限请求及处理结果。
- 文件读取、修改和 Diff。
- 终端命令及输出。
- Usage。
- Turn 完成、取消或失败。

Renderer 只消费统一事件，不直接理解 Pi 事件或原始 ACP JSON-RPC。

### 6.3 能力矩阵

每个 Agent Profile 保存实际探测到的能力：

```text
supportsLoadSession
supportsResumeSession
supportsPlans
supportsPermissions
supportsFilesystem
supportsTerminal
supportsConfigOptions
supportsUsage
supportsElicitation
```

UI 必须按能力渐进增强：

- Agent 支持配置选项时，动态渲染其模型、模式或推理选项。
- Agent 通过 `available_commands_update` 发布命令时，Composer 输入 `/` 后展示该会话的实时命令快照。
- Agent 不支持会话恢复时，提供“新建会话并发送交接摘要”。
- Agent 不支持计划时，不显示空计划面板。
- 知远不能硬编码某个外部 Agent 一定支持某项能力。

`available_commands_update` 按 ACP 语义是某个 Session 的完整替换快照，不是增量事件。知远按
Session 持久化 `name`、`description`、`input.hint` 和 `_meta`，后续更新整体覆盖旧值；切换 Lane
时只显示当前 Agent 当前 Session 声明的命令，不能把一个 Agent 的命令泄漏到另一个 Agent。

斜杠命令是外部 Agent 暴露其 MCP、Skill 和自身操作入口的标准 UI 通道。知远不解析或复制外部
Agent 的私有 Skill/MCP 配置，也不把知远的模型、Skill 或 MCP 注入外部 Agent。比如 Codex 或
Claude Code Adapter 声明 `/mcp`、`/skills` 或具体 Skill 命令时，Composer 原样呈现并将用户选中
后的文本通过 `session/prompt` 发回原 Agent；Agent 自己负责执行与返回 Tool Call 更新。

### 6.4 Codex 与 Claude Code 的内置 ACP 桥接

Codex 与 Claude Code 作为首批一等外部 Agent，采用“用户安装 Agent、知远内置桥接”的交付方式：

- 应用固定打包 `@agentclientprotocol/codex-acp@1.6.2` 与 `@agentclientprotocol/claude-agent-acp@0.70.0`，运行时不执行 `npx`，不联网下载 Adapter。
- 发现层只被动查找用户设备上的 `codex` 与 `claude`；应用依赖目录中由 Adapter 带入的 CLI 不算作用户安装。
- Adapter 由当前 Electron 可执行文件通过 `ELECTRON_RUN_AS_NODE=1` 启动，开发环境与 `app.asar` 安装包使用同一条路径模型。
- Codex 通过 `CODEX_PATH` 指向用户 CLI；Claude Code 通过 `CLAUDE_CODE_EXECUTABLE` 指向用户 CLI，因此继续使用各自账号、模型和配置。
- 旧版 `needs_adapter` Profile 原地升级并保留 Profile ID，避免已有 Lane 失去引用；Adapter 版本或 CLI 路径变化后重新 Probe。
- UI 只展示用户安装的 Agent 路径和“检测连接”，不暴露桥接器安装概念。

## 7. 内置知远编程 Agent

### 7.1 定位

知远编程 Agent 是默认 Agent，而不是外部 Agent 不可用时才出现的降级入口。

它必须支持：

- 独立完成编程任务。
- 读取和修改工作区文件。
- 执行命令和测试。
- 请求工具权限。
- 生成 Diff 和 Artifact。
- 作为多 Agent 任务的主 Agent、实现 Agent、修复 Agent 或验证 Agent。

### 7.2 可用性

- 不要求用户安装 Claude Code、Codex、OpenCode 或 ACP Adapter。
- 用户已配置可用模型时，可以直接开始任务。
- 如果知远本身尚未配置任何可用模型，菜单仍显示内置 Agent，但状态为“需要配置模型”，并引导用户完成知远自身配置。
- 外部 Agent 的认证状态不得影响内置 Agent。

### 7.3 配置边界

- 内置 Agent 使用知远现有模型、权限、Skills、MCP 和本地推理配置。
- 这些配置不复制给外部 Agent。
- 外部 Agent 只使用自己的账号、模型、工具和 ACP Config Options。

## 8. 外部 ACP Agent

### 8.1 ACP 映射

| ACP 能力                          | 知远内部对象                            |
| --------------------------------- | --------------------------------------- |
| `initialize`                      | Agent Profile、协议和能力快照           |
| `authenticate`                    | Agent 认证流程                          |
| `session/new`                     | 新 Agent Lane 会话                      |
| `session/load` / `session/resume` | 会话恢复                                |
| `session/prompt`                  | Assignment Run 中的一轮执行             |
| `session/update`                  | 规范化事件流                            |
| `available_commands_update`       | 当前 Lane 的斜杠命令完整快照            |
| Agent Plan                        | 计划展示                                |
| Tool Call / Diff                  | Tool Event、Changes、Artifact           |
| Permission Request                | 持久化 Approval                         |
| `fs/*`                            | Workspace Broker                        |
| `terminal/*`                      | Terminal Broker                         |
| `session/cancel`                  | 取消当前轮次                            |
| `stopReason`                      | Run 的轮次结束信号，不代表 Mission 完成 |

协议参考：

- [ACP Introduction](https://agentclientprotocol.com/get-started/introduction)
- [ACP Protocol Overview](https://agentclientprotocol.com/protocol/v1/overview)
- [ACP Architecture](https://agentclientprotocol.com/get-started/architecture)
- [ACP Initialization](https://agentclientprotocol.com/protocol/v1/initialization)
- [ACP Session Setup](https://agentclientprotocol.com/protocol/v1/session-setup)
- [ACP Prompt Turn](https://agentclientprotocol.com/protocol/v1/prompt-turn)
- [ACP Tool Calls](https://agentclientprotocol.com/protocol/v1/tool-calls)
- [ACP Authentication](https://agentclientprotocol.com/protocol/v1/authentication)
- [ACP TypeScript SDK](https://agentclientprotocol.com/libraries/typescript)

### 8.2 传输

第一版只支持当前稳定的本地 stdio 传输：

- 知远按需启动外部 Agent 或 Adapter 子进程。
- stdin/stdout 承载换行分隔的 UTF-8 JSON-RPC。
- stderr 只用于诊断日志，绝不进入协议解析。
- 使用精确 executable 和 argv，禁止通过拼接 shell 字符串启动。
- 远程 HTTP/WebSocket 传输待 ACP 相应规范稳定后再评估。

### 8.3 Connection Supervisor

`AcpConnectionSupervisor` 负责：

- 子进程启动和退出。
- 请求 ID 与 pending request。
- JSON 分片、粘包、非法消息和超时。
- 协议初始化和能力协商。
- stderr 诊断流。
- 崩溃检测和有限重启。
- App 退出时的资源释放。

一个 Agent Profile 的连接可以承载多个 ACP Session。每个 Session 必须有知远本地 ID 与远端 opaque session ID 的映射。

## 9. Agent 发现与管理

### 9.1 内置 Agent

内置 Agent 由应用静态注册：

- 永远出现在 Agent Picker 第一组。
- 不参加本机扫描。
- 不依赖 ACP Probe。
- 状态只取决于知远自身模型和运行时是否可用。

### 9.2 外部 Agent 两阶段发现

第一阶段是被动扫描，不启动未知命令：

- `PATH`。
- 已知用户级二进制目录。
- npm、pnpm、Bun、uv 等包管理器安装信息。
- ACP Registry 的发行名称、Adapter 和启动参数元数据。
- 用户显式添加的自定义 Agent 命令。

禁止默认全盘扫描。

第二阶段是显式 Probe：

- 只启动已匹配或用户确认的命令。
- 最多等待约 5 秒完成 `initialize`。
- 记录协议版本、能力、认证方式和会话恢复能力。
- Probe 完成后关闭进程，不发送项目任务。

### 9.3 状态模型

```text
Detected        检测到 Agent，但尚未验证 ACP
Ready           ACP 握手成功，可以使用
NeedsAdapter    Agent 存在，但需要 ACP Adapter
NeedsAuth       ACP 可用，但需要登录
Incompatible    协议或必需能力不兼容
Untrusted       自定义命令，等待用户确认
Unavailable     原来可用，但当前可执行文件已消失或启动失败
```

ACP Registry 只能作为安装和启动元数据来源，不能作为本机已安装的证明。第一版不自动安装 Adapter，只提供明确的管理和安装入口。

## 10. Workspace / Session 领域模型

### 10.1 层级

```text
CodingWorkspace               用户可见的编程工作区
├── SourceFolder × N          用户明确挂载的源文件夹
└── CodingSession × N         创建时永久绑定一个 Agent
    └── CodingMission         Session 所属的用户目标
        ├── AgentLane × N      主 Session 与协作 Session 的执行内核
    ├── CodingAssignment × N   分配给某个 Agent 的工作单元
    │   └── Workbench Task
    │       └── Run × N
    ├── HandoffPackage × N
    ├── Approval × N
    └── Artifact × N
```

### 10.2 CodingWorkspace

代表编程模式自有的逻辑工作区，不复用工作模式 Project，也不因重命名而修改磁盘目录。至少保存：

- 用户定义的显示名称。
- 一个主 SourceFolder 和零到多个附加 SourceFolder。
- 当前选中的 CodingSession。
- 当前 Mission。
- 当前 Agent Lane。
- Git 仓库和冻结基线信息。
- 协作和写入隔离策略。

每个 CodingSession 必须选择其中一个 SourceFolder 作为固定 cwd。Workspace 只是访问范围和组织容器，不是把多个目录拼成一个虚拟文件系统。

### 10.3 CodingSession

Session 是侧边栏中用户实际创建和切换的对象，保存：

- 创建它的 Agent Profile ID，创建后不可修改。
- 固定 SourceFolder / cwd。
- 本地 Session ID 与外部 ACP opaque Session ID。
- 独立 Draft、Scroll Position、事件流和 Config Options。
- 所属 Mission、Assignment 和协作父 Session。

“切换 Agent”的产品语义是切换到另一个 Session，或用目标 Agent 新建 Session；禁止把已有 Session 重新绑定给另一个 Agent。ACP `session/load` 也只能由同一 Agent Profile 在同一 SourceFolder 中恢复。

### 10.4 CodingMission

代表用户在左侧任务列表看到的一个完整编程目标，例如“修复登录刷新问题”。

Mission 不直接等于某个 ACP Session，也不应因为某一轮 `stopReason=end_turn` 就自动完成。

### 10.5 AgentLane

每个参与 Agent 一条 Lane，保存：

- Agent Profile ID。
- Driver Kind。
- 本地 Session ID。
- 外部 ACP Session ID（如适用）。
- 当前 Assignment 和 Run。
- Draft、Scroll Position 和事件游标。
- Agent 提供的 Config Options。
- 工作树和 Writer Lease。
- 运行、等待权限、需认证、断开、完成等状态。

用户切换 Session 时只修改 `activeAgentLaneId`，不得销毁其他 Lane，也不得修改 Lane 的 Agent Profile ID。协作者会创建新的 Lane/Session，而不是改变原 Session。

### 10.6 CodingAssignment

Mission 中交给单个 Agent 的明确工作单元，例如：

- 实现修复。
- 只读审查 Diff。
- 执行测试并验证。
- 根据审查意见修改。

每个 Assignment 映射到独立 Workbench Task/Run，避免多个 Agent 争用单一 `active_run_id`。

### 10.7 HandoffPackage

Agent 间交接使用不可变交接包：

- Mission 目标和约束。
- Assignment 说明。
- 基线 Git commit。
- 修改文件和 Diff。
- 已运行命令及退出状态。
- 测试结果。
- 已做决策及原因。
- 未解决问题。
- Artifact 和资源引用。
- 来源 Agent、目标 Agent、创建时间。

交接包通过标准 Prompt Content Blocks 发送给下一个 Agent，不依赖私有 ACP 方法。

## 11. 多 Agent 协作

### 11.1 默认行为

- 一个 Mission 初始只有一个主 Agent。
- Composer 默认只向当前选中的 Agent 发送消息。
- 切换 Agent 不自动广播消息或交接上下文。
- 添加协作者和交接都必须是显式用户动作或用户启用的协作预设动作。
- 知远不使用自己的模型在幕后替用户决定哪个外部 Agent 应该做什么；协作编排按确定性规则或用户选择执行。

### 11.2 协作预设

#### 实现 → 审查 → 验证

```mermaid
sequenceDiagram
    participant U as 用户
    participant I as 实现 Agent
    participant O as Coding Room
    participant R as 审查 Agent
    participant V as 验证 Agent

    U->>I: 提交编程任务
    I->>O: 修改、Diff、测试和决策
    O->>R: 生成并发送只读交接包
    R->>O: 审查意见
    O->>V: 发送基线、Diff 和审查意见
    V->>O: 测试与验证结果
    O->>U: 汇总状态，等待验收
```

#### 并行方案评审

- 多个 Agent 从同一冻结基线进行只读分析。
- 各 Agent 独立输出方案。
- 用户选择方案，或指定一个 Agent 接收其他方案并汇总。
- 不允许只读阶段产生工作区写入。

#### 主 Agent + 专项 Agent

- 主 Agent 负责整体实现。
- 专项 Agent 负责测试、安全、性能或文档。
- 专项结果通过 HandoffPackage 返回主 Agent。

### 11.3 内置 Agent 的协作地位

知远编程 Agent 可以承担任何角色：

- 单独完成任务。
- 作为主 Agent 分配审查或验证工作。
- 接收外部 Agent 的实现结果并修复。
- 在外部 Agent 认证失败、断开或崩溃后继续处理。

它不是“外部 Agent 全部失败后的隐藏降级项”，而是 Agent Picker 中始终可见的一等选项。

## 12. 工作区并发与写入隔离

### 12.1 默认 Writer Lease

同一 SourceFolder 默认只有一条 Agent Lane 可以持有写权限；不同 SourceFolder 的 Lease 相互独立：

- 当前 Writer 可以修改文件和执行会写入的命令。
- 其他 Agent 默认只读。
- Writer 切换必须等待当前写操作结束，并产生清晰的 Lease 转移事件。
- 权限弹窗应显示请求 Agent、目标路径、操作和当前 Lease 状态。

### 12.2 Git 并行写入

需要多个 Agent 并行实现时：

- 从同一冻结 Git 基线为每条 Writer Lane 创建应用管理的 Worktree。
- 每个 Agent 只操作自己的 Worktree。
- Changes 面板按 Lane 展示 Diff。
- 合并或应用回用户主工作区必须获得用户确认。
- 冲突进入显式冲突处理 UI，不自动覆盖。

### 12.3 非 Git 工作区

- 不提供并行 Writer。
- 多 Agent 只能串行写入或并行只读。
- 不通过复制整个目录伪造 Worktree。

## 13. 文件系统、终端和认证

### 13.1 Workspace Broker

- 所有路径转换为绝对路径。
- 使用 `realpath` 校验真实目标。
- 目标必须位于工作区根目录或用户明确授权的附加目录。
- 阻止 `../`、符号链接和挂载点逃逸。
- 文件修改记录到事件流、Artifact 和审计信息。

### 13.2 ACP Terminal

ACP `terminal/create` 表示启动非交互命令并返回输出，不等同于 PTY 或完整 CLI TUI。

`TerminalBroker` 负责：

- command、args、env 和 cwd。
- 输出字节限制和截断标记。
- wait、kill 和 release。
- 退出码和信号。
- 与 Tool Call 的关联。

现有 AI Elements Terminal 可以作为输出渲染基础，但不能直接承担认证 PTY。

### 13.3 Auth Terminal

外部 Agent 声明终端认证时，使用独立 `AuthTerminalService`：

- 创建交互式 PTY。
- 只执行 Agent 声明或用户确认的认证命令。
- 认证完成后关闭 PTY。
- 重新启动 ACP 连接并再次初始化。
- 不把 PTY 输出当作 ACP stdout 解析。

## 14. 安全边界

### 14.1 外部进程环境变量

外部 Agent 使用最小化、允许列表式环境：

- 必需的 PATH、Home 和 Locale。
- Agent Profile 明确配置的变量。
- Agent 官方认证所需且用户授权传递的环境。

禁止默认批量继承：

- 知远 Provider Key。
- 知远模型配置。
- 与目标 Agent 无关的云服务凭据。
- 主进程的完整环境变量集合。

日志必须屏蔽认证值和敏感环境变量。

### 14.2 ACP Permission 的真实边界

ACP Permission 只能治理 Agent 通过 ACP Client 请求的操作。如果外部 Agent 自身拥有直接访问本机的工具，ACP 不天然构成强沙箱。

因此产品文案不能宣称“所有外部 Agent 都被完全隔离”。严格隔离属于后续能力，需要结合：

- 系统沙箱。
- 容器或虚拟化。
- 受限工作树。
- 受控环境变量和文件挂载。

### 14.3 能力声明

知远只在真正完成某个 Client Capability 时才向 Agent 声明支持，不能为了通过握手虚假声明文件系统、终端、认证或 Elicitation 能力。

## 15. UI 信息架构

### 15.1 总体布局

参考 Zed 的 Agent 切入方式，但编程 Workspace 直接接管应用主侧边栏下半区，不在工作台内部叠加第二级侧边栏。

```text
┌──────────────────────┬────────────────────────────────────┬───────────────────┐
│ 工作 / 对话          │ 知远智能体 · Codex                │ Changes / Files   │
│ 新建任务             ├────────────────────────────────────┤ / Terminal        │
│ 本地推理             │                                    │                   │
│ 编程                 │ 当前 Session 的结构化事件流         │ Diff Preview      │
│ 自动化               │ Message / Plan / Tool / Permission │                   │
│                      │ / Terminal / Handoff                │                   │
│ 编程工作区        ＋ │                                    │                   │
│ ▼ 知远智能体      …  │                                    │                   │
│   Fix login · Codex  ├────────────────────────────────────┤                   │
│   Review · Claude    │ 发给当前 Agent…              发送   │                   │
│ + 添加工作区         │                                    │                   │
└──────────────────────┴────────────────────────────────────┴───────────────────┘
```

右侧 Inspector 没有内容时可以折叠，为中央事件流释放空间。

### 15.2 主侧边栏模式隔离

- `MainView.Coding` 激活时，主侧边栏下方只渲染编程 Workspace / Session 树。
- 离开编程模式后，按当前 Work / Chat 状态恢复原项目树或会话记录。
- 三套树使用独立数据源、选择状态和持久化键，不互相创建、重命名或删除对象。
- 收起主侧边栏时，工作台标题栏必须保留展开入口。
- 中央工作台不再显示“编程任务”列表或移动端的第二个任务 Sheet。

### 15.3 Workspace 与 Session 创建

Workspace 创建/编辑 Dialog 包含显示名称、默认 Agent 和一个或多个 SourceFolder。默认 Agent 是新建 Session 草稿的首选项，不会改变已有 Session 的绑定。添加文件夹只挂载现有目录；移除 Workspace 只删除知远中的编程记录，永远不删除磁盘文件。

每个 Workspace 行的 `＋` 创建 Session：

1. 点击后立即进入中央空白对话页，仅创建 renderer 内存中的 Session Draft，不写 SQLite，也不调用 ACP `session/new`。
2. Draft 默认选中 Workspace 的默认 Agent 和主 SourceFolder；首条消息发送前二者均可更换。
3. 首次发送时，主进程依次校验 Agent/Profile 与模型可用性、建立 Agent Session、持久化 CodingSession/Mission/Lane，并发送首条 Prompt。
4. 任一步骤失败都不保留本地 Session 记录；用户仍停留在 Draft 中修改 Agent、目录或消息后重试。
5. 创建成功后冻结 Agent Profile 和 SourceFolder 绑定，不再提供原地切换入口。
6. Session 名称不要求用户填写。ACP Agent 的 `session_info_update.title` 是权威名称；在 Agent 尚未上报标题时，用首条请求生成临时名称。

### 15.4 Zed 式 Agent 选择

左侧“编程任务”标题旁的 `＋` 用于新建任务：

```text
┌──────────────────────────────┐
│ 内置                         │
│                              │
│ ✦ 知远编程 Agent        可用 │
│   无需安装外部 Agent         │
├──────────────────────────────┤
│ 外部 Agent                   │
│                              │
│ * Claude Code           就绪 │
│ ◇ Codex                需登录│
│ ▣ OpenCode              就绪 │
├──────────────────────────────┤
│ 扫描并管理 Agent             │
│ 添加命令、Adapter 或重新探测 │
└──────────────────────────────┘
```

规则：

- 内置 Agent 永远在第一组第一项。
- 不显示内部运行时名称。
- 状态与选项在同一行可见，不依赖 Hover。
- Draft 中选择 Agent 不创建任何持久化对象；首条消息成功发送后才创建 CodingSession、Mission 和主 Agent Lane。
- `NeedsAuth` Agent 先进入认证流程，认证成功后再创建 Session。
- `NeedsAdapter` Agent 进入管理页，不自动安装。
- 自定义命令必须先确认信任。

### 15.5 没有外部 Agent

```text
┌──────────────────────────────┐
│ 内置                         │
│ ✦ 知远编程 Agent        可用 │
├──────────────────────────────┤
│ 外部 Agent                   │
│ 尚未检测到外部 Agent         │
├──────────────────────────────┤
│ 扫描并管理 Agent             │
└──────────────────────────────┘
```

- 不出现阻塞式安装引导。
- 首次进入时可以直接用知远编程 Agent 创建 Session。
- 扫描外部 Agent 在后台进行，不能阻塞内置 Agent。

### 15.6 新建 Session 与添加协作者

两个入口复用 Agent Picker 组件，但语义不同：

| 入口                 | 行为                                                 |
| -------------------- | ---------------------------------------------------- |
| Workspace 行 `＋`    | 打开空白 Draft；首发前可选择 SourceFolder 和主 Agent |
| 任务顶部“添加协作者” | 在当前 Mission 中创建新的 Agent Lane                 |
| 点击参与者           | 切换当前 Agent Lane，不产生交接                      |
| “交接给…”            | 生成并预览 HandoffPackage，确认后发送                |

### 15.7 Composer

- 默认目标是当前 Agent。
- 始终显示“发送给：Agent 名称”。
- 切换 Agent 时切换该 Lane 的独立 Draft。
- 第一版不提供含糊的默认“广播给所有 Agent”。
- 团队任务由协作预设或明确的多 Agent 操作触发。

### 15.8 响应式

- 宽屏：应用主侧边栏、事件流、Inspector。
- 中等宽度：Inspector 折叠，保留应用主侧边栏和事件流。
- 窄屏：应用主侧边栏使用现有折叠机制；Inspector 使用底部 Sheet，不再创建编程任务 Sheet。
- 权限请求、停止按钮和发送目标在任何宽度都不能依赖 Hover。
- 必须验证浅色、深色、键盘操作和 Focus Visible。

### 15.9 组件约束

实现时必须优先使用现有组件：

- shadcn：Button、Popover、Command、Dialog、Sheet、Tabs、ScrollArea、Tooltip、Badge、Skeleton。
- ai-elements：Conversation、Message、PromptInput、Reasoning、Tool、Terminal、CodeBlock。
- 图标统一使用 `lucide-react`。
- 用户可见文字进入中英文 i18n。
- 不自造 Button、Popover、Tabs、Terminal 基础组件。

## 16. 生命周期

### 16.1 应用启动

```text
注册内置 Agent
  ↓
内置 Agent 立即进入可判断状态
  ↓
后台进行外部 Agent 被动扫描
  ↓
对匹配项执行受控 ACP Probe
  ↓
更新 Agent Registry Cache
```

外部扫描失败不能影响内置 Agent 和其他工作模式启动。

### 16.2 新建内置任务

```text
选择 CodingWorkspace / SourceFolder
  ↓
选择知远编程 Agent
  ↓
创建 Agent 绑定不可变的 CodingSession / CodingMission
  ↓
创建 Builtin AgentLane
  ↓
BuiltinCodingDriver 创建运行时会话
  ↓
用户发送 Prompt
```

### 16.3 新建外部任务

```text
选择 CodingWorkspace / SourceFolder 与外部 Agent
  ↓
检查 Discovery / Probe 状态
  ↓
如有需要，完成 Agent 自己的认证
  ↓
启动或复用 ACP Connection
  ↓
initialize / session/new
  ↓
保存远端 sessionId
  ↓
用户发送 Prompt
```

### 16.4 应用重启恢复

- 恢复 CodingRoom、Mission、Lane 和事件游标。
- 内置 Agent 使用现有运行时恢复能力。
- ACP Agent 优先 `session/load` 或 `session/resume`。
- 不支持恢复时，创建新 Session，并要求用户确认是否发送恢复交接摘要。
- 不能静默伪造“原会话已恢复”。

## 17. 持久化建议

建议新增应用自有 SQLite 表或在现有 Workbench Task 领域上增加清晰关联：

- `coding_rooms`
- `coding_workspace_sources`
- `coding_missions`
- `coding_agent_profiles`
- `coding_agent_lanes`
- `coding_assignments`
- `coding_handoffs`
- `coding_events`
- `coding_workspace_leases`
- `coding_source_writer_leases`

要求：

- ACP session ID 按 Agent Profile 和 Lane 保存，视为 opaque string。
- 不持久化外部 Agent 的明文密码或 Token。
- 认证凭据继续由 Agent 自己或系统安全存储管理。
- Event Store 采用 append-only 事件，必要状态由投影构建。
- 大型终端输出和 Diff 应限制大小或使用独立 Artifact 存储。

## 18. 建议模块结构

```text
src/shared/codingAgent/
├── constants.ts
├── types.ts
└── ipc.ts

src/main/codingAgent/
├── codingAgentRegistry.ts
├── codingRoomService.ts
├── codingRoomRepository.ts
├── collaborationService.ts
├── workspaceBroker.ts
├── terminalBroker.ts
├── authTerminalService.ts
├── drivers/
│   ├── codingAgentDriver.ts
│   ├── builtinCodingDriver.ts
│   └── acpCodingDriver.ts
└── acp/
    ├── registryCache.ts
    ├── discoveryService.ts
    ├── probeService.ts
    ├── connectionSupervisor.ts
    └── sessionController.ts

src/main/ipcHandlers/
└── codingAgent.ts

src/renderer/components/coding/
├── CodingWorkbenchView.tsx
├── CodingWorkspaceSidebar.tsx
├── CodingWorkspaceDialog.tsx
├── CodingDraftControls.tsx
├── CodingAgentPicker.tsx
├── CodingParticipants.tsx
├── CodingEventStream.tsx
├── CodingInspector.tsx
├── CodingComposer.tsx
└── CodingSetupView.tsx

src/renderer/services/
└── codingAgent.ts

src/renderer/store/slices/
└── codingAgentSlice.ts
```

接线文件只做最小改动：

- `src/main/main.ts`
- `src/main/preload.ts`
- `src/renderer/App.tsx`
- `src/renderer/components/SidebarNavigationControls.tsx`
- `src/renderer/components/Sidebar.tsx`
- Redux root store。
- Renderer 和 Main i18n。

不得继续把大量编程业务逻辑追加到已有超长的 `main.ts`、`App.tsx` 或 `CoworkView.tsx`。

## 19. 实施阶段

### P0：协议与 Driver 验证

目标：冻结内部 Driver 合约并消除外部 Agent 兼容性未知项。

- 定义统一类型、事件和能力矩阵。
- 建立 Fake CodingAgentDriver 合约测试器。
- 引入官方 ACP TypeScript SDK 做最小样机。
- 在 macOS、Windows、Linux 验证 Claude Code、Codex、OpenCode。
- 覆盖初始化、认证、新会话、Prompt、取消、权限、Load/Resume、崩溃和退出。
- 确认每个 Adapter 是否复用对应 Agent 自身凭据，不做未经验证的假设。

### P1：内置单 Agent 编程模式

目标：无外部 Agent 时，编程模式已经完整可用。

- 创建 `CodingAgentDriver` 和 `BuiltinCodingDriver`。
- 接入现有内置 Agent Runtime。
- 增加“工作模式 → 编程”入口。
- 完成任务列表、Agent Picker、事件流、Composer 和基础 Inspector。
- 完成 Mission、Lane、Run 和事件持久化。
- 内置 Agent 静态注册并排在 Picker 第一位。

### P2：外部 ACP Agent

目标：外部 Agent 与内置 Agent 在同一 UI 中可选、可切换。

- Agent 被动发现和受控 Probe。
- Codex 与 Claude Code 官方 Adapter 固定版本随应用打包，并验证 `app.asar` 启动。
- ACP Connection Supervisor。
- `AcpCodingDriver`。
- 外部认证和 Auth Terminal。
- Config Options。
- Session 级 Available Commands、`/` 命令菜单以及动态替换。
- Load/Resume 和崩溃恢复。
- Agent 管理页。

### P3：多 Agent 协作

目标：在同一 Mission 中加入多个 Agent，并安全协作。

- 添加协作者和 Lane 切换。
- Assignment 和 HandoffPackage。
- Writer Lease。
- Git Worktree 并行写入。
- 实现→审查→验证预设。
- Workbench Task/Run/Approval/Artifact 路由解耦。

### P4：安装、远程与强隔离

- 基于 ACP Registry 提供可审计的 Adapter 安装。
- 用户确认版本、来源和命令后才能安装。
- 校验包来源和哈希。
- 远程 ACP 传输待规范稳定后实现。
- 评估容器、系统沙箱和受限挂载。

## 20. 测试与验收

### 20.1 Driver 合约

- 内置和 ACP Driver 产生一致的规范化事件。
- 未支持能力不会被错误声明或渲染。
- 取消只结束当前轮次，不删除 Mission。
- `stopReason` 不会直接标记用户任务完成。

### 20.2 ACP 协议

- JSON 分片和多消息粘包。
- 非法 stdout 和独立 stderr。
- 请求乱序、超时和取消。
- 版本与能力协商。
- 同一连接多 Session。
- `available_commands_update` 在 `session/new` 返回前到达、运行中替换以及 Session 间隔离。
- Agent 崩溃和重启。
- Load/Resume 支持与回退。

### 20.3 Agent 发现

- 无任何外部 Agent。
- 只安装主 CLI，没有 Adapter。
- Agent 已安装但需要认证。
- 自定义不可信命令。
- 原来可用的 Agent 被卸载。
- 扫描失败不影响内置 Agent。

### 20.4 安全

- `../` 路径逃逸。
- 符号链接逃逸。
- 未授权附加目录。
- 外部进程环境变量泄漏。
- 权限请求取消、过期和重复响应。
- Terminal 输出上限、kill、release。

### 20.5 多 Agent

- 切换 Agent 后 Draft、Scroll 和 Session 保持。
- Session 的 Agent Profile 与 SourceFolder 创建后不可变。
- 工作、对话、编程三套侧边栏数据和选择状态隔离。
- 默认 Prompt 只发给当前 Agent。
- HandoffPackage 内容稳定且不可变。
- 单 SourceFolder Writer Lease 互斥，不同 SourceFolder 可独立执行。
- Git Worktree 基线一致。
- 合并冲突不会自动覆盖。
- 非 Git 工作区禁止并行 Writer。

### 20.6 UI

- 浅色、深色、跟随系统。
- 320px、736px、1024px。
- Agent Picker 键盘操作和 Focus Visible。
- 权限请求不依赖 Toast 或 Hover。
- 发送目标始终可见。
- 外部 Agent 为空时仍能直接创建内置任务。

### 20.7 第一版完成定义

- 用户不安装任何外部 Agent，也能用知远编程 Agent 完成编程任务。
- 能正确区分并展示外部 Agent 的发现、连接、认证和兼容状态。
- 切换 Agent 不丢失会话。
- 没有知远模型配置被注入外部 Agent。
- 多 Agent 写入不会未经隔离作用于同一物理目录。
- 外部 Agent 崩溃不影响内置 Agent 和其他 Lane。
- Mission 完成需要验证或用户验收，不由单次 ACP Turn 自动决定。

## 21. 非目标

第一版明确不做：

- 把知远模型注入 Claude Code、Codex 或 OpenCode。
- 用 WebView 嵌入外部 Agent 的 CLI TUI。
- 默认广播 Prompt 给所有 Agent。
- 在运行时下载或安装任何外部 Agent；Codex 与 Claude Code 的固定版本 ACP 桥接器随应用交付。
- 全盘扫描用户设备。
- 依赖私有 ACP RPC 完成核心协作。
- 宣称 ACP Permission 等同于系统级强沙箱。
- 非 Git 目录中的多个 Agent 并行写入。
- 为统一架构而让内置运行时通过 ACP 自连接。

## 22. 待实施前确认项

以下问题应在 P0 结束时冻结：

1. OpenCode 当前推荐 ACP 启动方式、版本和凭据复用行为。
2. Claude Code、Codex 和 OpenCode 在 Windows、Linux 上的安装发现规则；Codex 的 macOS 规则已经验证。
3. Workbench Task 当前 Pi 耦合路径的最小解耦方案。
4. 内置 Agent Session 恢复与 Coding Mission 持久化的映射。
5. Git Worktree 的目录位置、清理策略和磁盘配额。
6. 外部 Agent 自带直接本机工具时，产品需要展示的安全提示级别。
7. P1 是否同时包含基础 Changes Inspector，还是先只展示事件内 Diff。

## 23. 设计结论

最终产品结构不是“一个 ACP 外壳”，而是：

> 内置知远编程 Agent 保证零外部安装可用；ACP 负责连接用户已有的外部 Agent；Zed 式 Agent Picker 负责统一切入；Coding Room 负责会话、任务、权限、工作区和多 Agent 协作。

这一结构既保留 ACP 的能力边界，也避免产品在用户没有安装外部 Agent 时变成空壳。
