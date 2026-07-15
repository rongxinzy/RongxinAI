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

| 字段 | 说明 |
| --- | --- |
| `id` | 由规范化路径计算出的稳定 ID |
| `name` | 侧栏显示名称，默认取目录名 |
| `path` | 规范化后的绝对路径，唯一 |
| `created_at` | 首次登记时间 |
| `updated_at` | 最近使用或重命名时间 |

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

| 操作 | 新会话 | 已有会话 |
| --- | --- | --- |
| 切换 Agent | 影响后续新会话 | 不改变角色 |
| 修改 Agent prompt | 影响后续新会话 | 不改变已保存 prompt |
| 切换 Workspace | 影响后续新会话 | 通过会话自身 Workspace 恢复 |
| 修改全局 Cowork prompt | 影响后续新会话 | 不覆盖历史 prompt |

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

| IPC | 用途 |
| --- | --- |
| `cowork:workspace:list` | 获取 Workspace 列表 |
| `cowork:workspace:ensure` | 按目录创建或获取 Workspace |
| `cowork:workspace:rename` | 修改 Workspace 显示名称 |

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
