# 我的 Agent 侧边栏样式与布局改造设计文档

状态：Draft  
日期：2026-05-07  
分类：功能  
参考：用户提供的「我的 Agent 侧边栏改造 Spec」  
适用范围：桌面端左侧侧边栏中的 Agent 导航、Agent 下任务会话入口、运行中与完成未读提醒

## 1. 概述

### 1.1 问题/背景

当前左侧侧边栏把 Agent 快速切换和 Cowork 任务记录分成两个相邻区域：

- `SidebarAgentList` 只展示可用 Agent，点击后切换当前 Agent。
- `CoworkSessionList` 只展示当前 Agent 过滤后的任务历史。
- 运行中和未读状态由 `CoworkSessionItem` 在任务列表里展示，但用户需要先理解当前选中的 Agent，才能知道这些任务属于谁。

这会让「我的 Agent」更像一个切换器，而不是一个可以承载多 Agent、多任务并行状态的工作区导航。参考 spec 希望侧边栏表达新的信息架构：

```text
我的 Agent
  默认 Agent
    分析 Q1 销售数据
    生成产品发布会 PPT v3
    竞品 SWOT 分析
    展开显示
    折叠显示
  数据分析师
  市场调研员
```

因此本次改造应把 Agent 和任务会话合并成树形导航：Agent 是分组节点，任务是可恢复的会话节点。侧边栏只表达轻量状态，不承担完整执行日志或任务管理页职责。

### 1.2 目标

1. 在左侧侧边栏展示「我的 Agent」标题、创建入口和 Agent 树。
2. 每个 Agent 可展开/收起，展开后展示最近任务会话预览。
3. 任务运行中时在任务标题后展示 loading。
4. 任务完成且用户未打开时在任务标题后展示绿色未读点。
5. Agent 行不展示右侧 badge，不展示任务数和未读数。
6. 任务超过默认预览数量时展示「展开显示」，不展示剩余数量。
7. 点击任务后切换到对应 Agent，并恢复该任务会话。
8. 展开状态、更多任务展开状态等本地 UI 偏好可在应用重启后恢复。

### 1.3 非目标

- 不重做主工作区的聊天、执行详情、工具权限或 Artifact 面板。
- 不实现完整 Agent 市场、模板商店或复杂任务历史页。
- 不把失败、等待审批、暂停等完整任务状态都编码进侧边栏。
- 不在本次改造中引入 Agent 右侧 badge、任务计数或剩余数量文案。
- 不改变 OpenClaw 运行时协议，只消费现有会话列表、状态和流事件。

## 2. 用户场景

### 场景 1: 查看多个 Agent 的任务状态

**Given** 用户有多个已启用 Agent，并且其中一些 Agent 有正在执行或刚完成的任务  
**When** 用户打开左侧侧边栏  
**Then** 用户能看到 Agent 分组，以及展开 Agent 下任务标题后的 loading 或绿色未读点

### 场景 2: 从 Agent 下恢复历史任务

**Given** 用户上午在「数据分析师」下发起了一个任务，下午想继续查看  
**When** 用户展开「数据分析师」并点击对应任务  
**Then** 应用切换到该 Agent，打开该 Cowork session，并清除该任务的完成未读提醒

### 场景 3: 任务较多时保持可扫描

**Given** 某个 Agent 下有超过默认预览数量的任务  
**When** 用户展开该 Agent  
**Then** 默认只展示最近任务预览，底部展示「展开显示」，不展示剩余数量

### 场景 4: 当前任务实时完成

**Given** 用户未打开某个正在执行的任务  
**When** 该任务完成  
**Then** 对应任务行从 loading 变为绿色未读点，Agent 行不新增 badge

## 3. 功能需求

### FR-1: 合并 Agent 与任务会话为树形导航

侧边栏中的 Agent 区域应从「Agent 快速切换列表 + 当前 Agent 任务记录」改为「Agent 分组 + 任务会话预览」。

第一期实现建议替换 `Sidebar.tsx` 中的 `SidebarAgentList` 和紧随其后的 `coworkHistory` 区域，但保留侧边栏顶部已有的新建对话、搜索、技能、设置等全局入口。

### FR-2: Agent 行只表达分组

Agent 行结构：

```text
[agent icon/avatar] [agent name]
```

要求：

- Agent icon 直接排在最前面，和「我的 Agent」标题起点对齐。
- Agent icon 不使用高亮背景底色。
- 点击 Agent 行展开或收起。
- 已展开 Agent 再次点击时收起。
- 未展开 Agent 点击后只展开，不自动选择任务。
- Agent 名称单行截断。
- Agent 行不展示右侧 badge、未读数、任务数或复杂状态图标。
- hover 时可显示更多菜单入口，菜单只承担 Agent 级操作。

### FR-3: 任务行只表达标题和轻量提醒

任务行结构：

```text
[task title] [loading 或 unread dot] [relative time]
```

要求：

- 任务标题单行截断，不换行，不撑宽侧边栏。
- 任务行背景占满 Agent 列可用宽度；内容左侧与 Agent 名称左侧对齐。
- 任务行右侧展示紧凑相对时间，单位从小时起步，例如 `1 小时`、`10 小时`、`2 天`、`1 周`、`1 月`、`1 年`。
- 相对时间单位按阈值切换：`<24h` 显示小时，`>=24h` 显示天，`>=7d` 显示周，`>=30d` 显示月，`>=12mo` 显示年。
- hover 展示更多操作时，相对时间可淡出，避免和更多按钮重叠。
- 运行中任务在标题后展示 loading，尺寸建议 `12px * 12px`。
- 完成未读任务在标题后展示绿色圆点，尺寸建议 `7px * 7px`。
- 普通历史任务和已读任务不展示图标。
- loading 优先级高于未读点。
- 失败、暂停、等待审批等状态不在侧边栏新增图标，由主工作区表达。

### FR-4: 任务预览数量与「展开显示」

每个展开 Agent 默认展示 6 条任务预览。

当该 Agent 有更多任务时，在任务列表底部展示：

```text
展开显示
```

要求：

- 不显示「还有 N 条」或任何剩余数量。
- 点击后在当前 Agent 下展示全部任务。
- 全部任务底部展示「折叠显示」。
- 点击「折叠显示」后回到默认最近 6 条。
- 「展开显示」只作用于当前 Agent，不影响其他 Agent。

### FR-5: 任务点击恢复会话

点击任务行后：

1. 调用 `agentService.switchAgent(agentId)` 切换当前 Agent。
2. 打开 Cowork 主工作区。
3. 调用 `coworkService.loadSession(sessionId)` 加载对应 session。
4. 若任务处于完成未读状态，清除该 session 的未读标记。

切换 Agent 和加载 session 应避免把所有 Agent 的任务预览状态清空。

### FR-6: 实时状态更新

侧边栏任务状态由会话摘要和现有流事件驱动：

- 创建任务后插入对应 Agent 的任务预览。
- 收到用户消息或 session status 变为 `running` 后展示 loading。
- 收到 complete 后，非当前打开任务应进入完成未读提醒。
- 当前打开任务收到新消息或 complete 时不显示未读点。
- 打开 `completed_unread` 任务后清除绿色未读点。

### FR-7: 本地 UI 偏好持久化

以下状态应通过 `localStore` 或已有 SQLite kv store 持久化：

- 展开的 Agent：`expandedAgentIds`
- 已展开更多任务的 Agent：`expandedTaskListAgentIds`
- 最近选中的 `agentId` 和 `taskId`

实时任务状态不应作为 UI 偏好持久化。运行中状态应来自会话状态恢复，应用重启后无法确认仍在运行的任务不应无限显示 loading。

### FR-8: i18n

新增用户可见文案必须写入 `src/renderer/services/i18n.ts` 的中英文区域。

预计新增 key：

| key | zh | en |
| --- | --- | --- |
| `myAgentSidebarExpandMore` | 展开显示 | Show more |
| `myAgentSidebarCollapse` | 折叠显示 | Show less |
| `myAgentSidebarNoAgents` | 还没有 Agent | No agents yet |
| `myAgentSidebarNoTasks` | 还没有任务 | No tasks yet |
| `myAgentSidebarNewTask` | 新建任务 | New task |
| `myAgentSidebarRunning` | 运行中 | Running |
| `myAgentSidebarUnreadResult` | 有新结果 | New result |
| `myAgentSidebarLoadFailed` | 加载失败，点击重试 | Failed to load. Click to retry |
| `myAgentSidebarHourShort` | 小时 | h |
| `myAgentSidebarDayShort` | 天 | d |
| `myAgentSidebarWeekShort` | 周 | w |
| `myAgentSidebarMonthShort` | 月 | mo |
| `myAgentSidebarYearShort` | 年 | y |

### FR-9: 常量化状态与模式

新增的状态值、偏好 key、组件模式不应使用跨文件裸字符串。应在所属模块的 `constants.ts` 中集中定义。

示例：

```typescript
export const AgentSidebarIndicator = {
  None: 'none',
  Running: 'running',
  CompletedUnread: 'completed_unread',
} as const;

export type AgentSidebarIndicator =
  typeof AgentSidebarIndicator[keyof typeof AgentSidebarIndicator];

export const AgentSidebarPreferenceKey = {
  State: 'myAgentSidebar.state',
} as const;
```

## 4. 实现方案

### 4.1 组件拆分

建议新增侧边栏树组件，避免继续扩大 `Sidebar.tsx`：

```text
src/renderer/components/agentSidebar/
  constants.ts
  types.ts
  MyAgentSidebarTree.tsx
  MyAgentSidebarHeader.tsx
  AgentTreeNode.tsx
  AgentTaskRow.tsx
  ExpandAgentTasksRow.tsx
  useAgentSidebarState.ts
```

职责：

| 组件/模块 | 职责 |
| --- | --- |
| `MyAgentSidebarTree` | 拉取 Agent 和任务预览，维护树结构，承接点击任务后的导航 |
| `MyAgentSidebarHeader` | 展示「我的 Agent」标题和新增入口 |
| `AgentTreeNode` | 展示 Agent 行、展开/收起、Agent 菜单 |
| `AgentTaskRow` | 展示任务标题、相对时间、loading、未读点、选中态和任务菜单 |
| `ExpandAgentTasksRow` | 展示并处理「展开显示」 |
| `useAgentSidebarState` | 管理展开状态、更多任务分页、偏好持久化 |

`Sidebar.tsx` 只负责把旧的 `SidebarAgentList` 和 `CoworkSessionList` 区块替换为 `MyAgentSidebarTree`，以及传入 `onShowCowork`、session 操作 handler。

### 4.2 数据模型

渲染层使用现有 `Agent` / `AgentSummary` 与 `CoworkSessionSummary` 派生侧边栏节点，不需要第一期新增数据库表。

```typescript
type MyAgentSidebarAgentNode = {
  id: string;
  name: string;
  icon: string;
  enabled: boolean;
  isExpanded: boolean;
  isTaskListExpanded: boolean;
  canExpandTasks: boolean;
  canCollapseTasks: boolean;
  tasks: MyAgentSidebarTaskNode[];
};

type MyAgentSidebarTaskNode = {
  id: string;
  agentId: string;
  title: string;
  status: CoworkSessionSummary['status'];
  pinned: boolean;
  updatedAt: number;
  createdAt: number;
  indicator: AgentSidebarIndicator;
  isSelected: boolean;
};
```

`indicator` 派生规则：

| 条件 | indicator |
| --- | --- |
| `session.status === 'running'` | `AgentSidebarIndicator.Running` |
| `session.status === 'completed'` 且 `unreadSessionIds` 包含该 session | `AgentSidebarIndicator.CompletedUnread` |
| 其他情况 | `AgentSidebarIndicator.None` |

### 4.3 任务预览加载

现有主进程 IPC `cowork:session:list` 已支持 `agentId`、`limit`、`offset`，可以复用作为第一期数据源。

注意：`coworkService.loadSessions(agentId)` 会写入全局 `cowork.sessions`，不适合同时加载多个 Agent 的预览。侧边栏树应新增独立加载函数，例如：

```typescript
async function loadAgentTaskPreview(agentId: string, offset: number, limit: number) {
  return window.electron?.cowork?.listSessions({ agentId, offset, limit });
}
```

这样不会覆盖当前 Cowork 会话列表，也不会和 `latestLoadSessionsRequestId` 的全局防抖逻辑互相干扰。

加载策略：

1. `agentService.loadAgents()` 加载 Agent 列表。
2. 对已启用 Agent 拉取默认 6 条任务预览。
3. 展开 Agent 时如果没有预览数据，立即拉取该 Agent 的第一页。
4. 点击「展开显示」时从 offset 0 开始分页拉取该 Agent 的完整任务列表，直到 `hasMore=false`。
5. 点击「折叠显示」时不清空已加载数据，只把当前 Agent 的展示窗口收回最近 6 条。
6. 有新任务流事件但本地没有对应 session 时，只刷新相关 Agent 的预览；无法确定 Agent 时再做全量轻量刷新。

### 4.4 Redux 状态调整

第一期可以把侧边栏树状态放在组件 hook 内，并只把持久化偏好写到 `localStore`。如果实时更新和测试复杂度升高，再新增 `agentSidebarSlice`。

推荐新增 slice 的条件：

- 任务预览需要被多个组件消费。
- 流事件需要集中更新所有 Agent 的任务节点。
- 需要对加载、错误、分页做稳定单测。

若新增 slice，建议结构：

```typescript
type AgentSidebarState = {
  expandedAgentIds: string[];
  expandedTaskListAgentIds: string[];
  taskPreviewsByAgentId: Record<string, CoworkSessionSummary[]>;
  hasMoreTasksByAgentId: Record<string, boolean>;
  loadingAgentIds: string[];
  failedAgentIds: string[];
};
```

### 4.5 未读状态与 complete 事件

当前 `coworkSlice` 已有 `unreadSessionIds`，并在 `addMessage`、`updateMessageContent` 中对非当前 session 标记未读。为了保证「完成后未点击」也稳定显示绿色点，应补充以下行为：

- complete 事件更新 session status 为 `completed` 时，如果该 session 不是当前打开 session，则标记为未读。
- 打开 session 时继续通过 `setCurrentSessionId` / `setCurrentSession` 清除未读。
- running 期间即使已未读，也优先展示 loading，complete 后再展示绿色未读点。

如果不希望改变全局未读语义，可新增专门的 `completedUnreadSessionIds`，但第一期优先复用现有 `unreadSessionIds`，减少状态来源。

### 4.6 任务排序

展开 Agent 后任务排序：

1. 按任务创建时间倒序展示。
2. 创建时间相同时，再按更新时间倒序稳定兜底。

点击任务、任务变成当前任务、运行中状态变化、完成未读状态变化、重命名、置顶或取消置顶，都不应改变该任务在 Agent 下的位置。

流式状态更新只更新行内 indicator，不主动重排任务列表。

### 4.7 视觉规格

侧边栏宽度沿用现有 `Sidebar.tsx` 的整体宽度策略，本次仅调整 Agent 树内部布局。

| 区域 | 规格 |
| --- | --- |
| Header 高度 | `40px` |
| Header 左右内边距 | 与顶部导航 icon 左边界对齐 |
| Header 标题颜色 | 低对比灰色，弱于 Agent/任务名称 |
| Agent 行高 | `34px` |
| 任务行高 | `30px` |
| Agent icon 尺寸 | `24px * 24px` |
| Agent icon 背景 | 无高亮底色 |
| 任务行左右边距 | Agent 列不额外增加水平内边距；背景行向外扩展到接近侧边栏边缘，参考旧历史列表的紧凑左右边距 |
| 任务内容左对齐 | 任务标题与 Agent 名称第一个字左侧对齐 |
| 任务相对时间 | 右侧紧凑展示，字号同任务标题 |
| 选中态 | 轻灰背景，圆角 `6px` |
| hover 态 | 轻灰背景 |

实现约束：

- 使用 Tailwind utility class，避免新增大段 bespoke CSS。
- 图标优先沿用项目已有 Heroicons 或本地 icon 组件。
- 文本不得溢出容器，最长标题使用 `truncate`。
- 顶部「新建任务」是操作入口，不跟随 Cowork 当前视图展示持久选中态。
- 不使用卡片嵌套卡片，不把侧边栏做成装饰性面板。
- 不新增大面积单色渐变、装饰光斑或营销式 hero 布局。

### 4.8 新增入口

Header 右侧展示 `+` 图标按钮，点击后打开菜单。

菜单项：

| 菜单项 | 行为 |
| --- | --- |
| 新建 Agent | 打开现有 `AgentCreateModal` |
| 从模板创建 | 跳转或打开现有 `AgentsView` 的 preset 区域 |
| 新建任务 | 仅当前有选中 Agent 时展示，切换到 Cowork 首页并聚焦输入框 |

第一期如果聚焦输入框成本较高，可以先只实现「新建 Agent」和「从模板创建」，但菜单结构应预留「新建任务」。

### 4.9 可访问性

- Agent 树容器使用 `role="tree"`。
- Agent 和任务节点使用 `role="treeitem"`。
- Agent 节点通过 `aria-expanded` 表达展开状态。
- loading 使用 `aria-label={i18nService.t('myAgentSidebarRunning')}`。
- 绿色未读点使用 `aria-label={i18nService.t('myAgentSidebarUnreadResult')}`。
- 支持基础键盘操作：
  - 上/下：移动焦点。
  - 左：收起 Agent 或回到 Agent 行。
  - 右：展开 Agent。
  - Enter：展开 Agent 或打开任务。

## 5. 边界情况

| 场景 | 处理方式 |
| --- | --- |
| 没有 Agent | 显示「还没有 Agent」和新建 Agent 入口 |
| Agent 没有任务 | 展开后显示「还没有任务」，可提供「新建任务」入口 |
| 拉取某个 Agent 任务失败 | 保留该 Agent 上一次成功数据，在局部显示「加载失败，点击重试」 |
| 应用重启后存在 `running` session | 以数据库恢复后的 status 为准；如果启动清理把运行中重置为 idle，不继续显示 loading |
| 任务标题为空 | fallback 到现有 session title 生成逻辑或 `untitled` 对应 i18n 文案 |
| Agent 被禁用 | 不展示在默认树中；如当前选中 Agent 被禁用，回退到 `main` |
| Agent 被删除 | 删除其节点和任务预览，当前在该 Agent 下时切回 `main` |
| 流事件只带 sessionId，不带 agentId | 先查本地 session map；查不到时通过 session 详情或轻量刷新恢复归属 |
| 多个 Agent 同时刷新 | 每个 Agent 独立 loading/error，不用一个全局 loading 覆盖整棵树 |
| 长任务名或长 Agent 名 | 单行截断，不改变行高，不撑开侧边栏 |
| 批量模式 | 第一阶段可继续只在完整历史列表中提供；树形任务行菜单保留批量入口 |

## 6. 涉及文件

| 文件 | 变更 |
| --- | --- |
| `src/renderer/components/Sidebar.tsx` | 替换 `SidebarAgentList` 和当前任务历史区为新的 Agent 树入口，保留全局导航和底部设置 |
| `src/renderer/components/agentSidebar/constants.ts` | 新增侧边栏 indicator、偏好 key、分页常量 |
| `src/renderer/components/agentSidebar/types.ts` | 新增 Agent 树节点和任务节点类型 |
| `src/renderer/components/agentSidebar/MyAgentSidebarTree.tsx` | 新增 Agent 树容器 |
| `src/renderer/components/agentSidebar/MyAgentSidebarHeader.tsx` | 新增标题栏和创建菜单 |
| `src/renderer/components/agentSidebar/AgentTreeNode.tsx` | 新增 Agent 行组件 |
| `src/renderer/components/agentSidebar/AgentTaskRow.tsx` | 新增任务行组件 |
| `src/renderer/components/agentSidebar/ExpandAgentTasksRow.tsx` | 新增「展开显示」组件 |
| `src/renderer/components/agentSidebar/useAgentSidebarState.ts` | 新增加载、分页、持久化偏好和派生 indicator 逻辑 |
| `src/renderer/store/slices/coworkSlice.ts` | 如有必要，complete 时对非当前 session 标记未读 |
| `src/renderer/store/selectors/coworkSelectors.ts` | 增加 Agent 树需要的 memoized selector |
| `src/renderer/services/agent.ts` | 复用现有 Agent 加载、切换、创建能力 |
| `src/renderer/services/cowork.ts` | 新增不污染全局 `sessions` 的任务预览加载方法，或抽出 IPC helper |
| `src/renderer/services/i18n.ts` | 新增中英文文案 |
| `src/renderer/types/cowork.ts` | 如新增 preview result 类型，在此补充 |
| `src/renderer/types/electron.d.ts` | 如暴露新的 preload helper，在此补充类型 |
| `src/main/preload.ts` | 如新增 IPC helper，暴露给 renderer |
| `src/main/main.ts` | 复用或扩展 `cowork:session:list` handler |
| `src/main/coworkStore.ts` | 第一阶段预计无需改动；如需要按 Agent 批量预览，可新增 store 方法 |

## 7. 验收标准

### 7.1 信息架构

- 左侧侧边栏出现「我的 Agent」树形区域和 `+` 新增入口。
- Agent 可展开和收起。
- 展开 Agent 后展示最近任务预览。
- 有更多任务时展示「展开显示」，不展示剩余数量。
- Agent 行不展示 badge、任务数或未读数。

### 7.2 状态与提醒

- 运行中任务标题后展示 loading。
- 完成且未打开的任务标题后展示绿色未读点。
- 打开完成未读任务后绿色点消失。
- 普通历史任务和已读任务不展示任何状态图标。
- running 优先级高于未读点。

### 7.3 交互

- 点击未展开 Agent 只展开该 Agent，不自动选择任务。
- 点击已展开 Agent 会收起该 Agent。
- 点击任务会切换到对应 Agent 并打开对应 Cowork session。
- 点击「展开显示」只展开当前 Agent 的全部任务。
- 点击「折叠显示」后恢复当前 Agent 最近 6 条。
- 展开状态和更多任务展开状态在刷新或重启后恢复。

### 7.4 视觉与布局

- Agent 行、任务行高度稳定，hover、选中态不引发布局跳动。
- 长 Agent 名称和长任务标题单行截断。
- 侧边栏滚动性能在多 Agent、多任务场景下稳定。
- 深色模式和浅色模式下 loading、绿色未读点、选中态均清晰可见。

### 7.5 可访问性

- Agent 树具备 `role="tree"` / `role="treeitem"` 语义。
- 展开状态通过 `aria-expanded` 暴露。
- loading 和未读点具备可读 label 或 tooltip。
- 键盘可以展开、收起和打开任务。

## 8. 验证计划

### 8.1 单元测试

| 测试点 | 建议位置 |
| --- | --- |
| `AgentSidebarIndicator` 派生逻辑 | `src/renderer/components/agentSidebar/useAgentSidebarState.test.ts` |
| 任务排序规则 | `src/renderer/components/agentSidebar/useAgentSidebarState.test.ts` |
| 展开状态持久化读写 | `src/renderer/components/agentSidebar/useAgentSidebarState.test.ts` |
| complete 后非当前 session 标记未读 | `src/renderer/store/slices/coworkSlice.test.ts` |
| 任务预览分页追加去重 | `src/renderer/components/agentSidebar/useAgentSidebarState.test.ts` |

### 8.2 手动验证

1. 启动 `npm run electron:dev`。
2. 创建至少 2 个 Agent。
3. 在每个 Agent 下创建多条任务，确认树形展示和「展开显示」。
4. 让一个非当前任务运行，确认任务标题后出现 loading。
5. 等任务完成，确认 loading 变为绿色未读点。
6. 点击该任务，确认切换 Agent、打开 session、绿色未读点消失。
7. 切换深色/浅色主题，确认可读性。
8. 重启应用，确认展开状态恢复，不出现无法确认的无限 loading。

### 8.3 回归验证

- Cowork 新建 session、继续 session、删除 session、重命名 session、置顶 session 不受影响。
- Agent 创建、预设 Agent 添加、Agent 设置编辑不受影响。
- `CoworkSessionList` 如果仍在其他入口使用，其现有排序、未读和批量能力不受影响。
- `coworkService.loadSessions(agentId)` 的现有调用语义不被任务预览加载破坏。

## 9. 分期建议

### Phase 1: 树形布局与静态任务预览

- 新增 Agent 树组件。
- 复用现有 IPC 按 Agent 拉取任务预览。
- 实现展开/收起、任务点击恢复会话和「展开显示」。
- 实现基本视觉样式、truncate、hover、选中态。

### Phase 2: 实时状态与未读提醒

- 接入流事件和 `unreadSessionIds`。
- complete 后非当前 session 标记未读。
- 实现 running loading 和完成未读绿点。
- 打开任务后清除完成未读提醒。

### Phase 3: 管理能力与可访问性补齐

- Agent 行和任务行更多菜单。
- 键盘导航与 ARIA 细节补齐。
- 任务批量操作入口整合。
- 性能优化和更多任务分页体验优化。

## 10. 开放问题

1. `+` 按钮第一期是否只打开新建 Agent，还是必须同时提供「从模板创建」和「新建任务」？
2. 如果某个 Agent 有数千条历史任务，是否需要给「展开显示」增加上限或虚拟列表？
3. 树形侧边栏上线后，是否仍保留独立的「任务记录」标题和旧历史列表入口？
4. `AgentsView` 的卡片式 Agent 管理页是否需要同步做视觉改造，还是保持为独立管理页？
5. 完成未读提醒是否仅对 `completed` 生效，还是 error 也需要某种提醒入口？本 spec 默认 error 不在侧边栏新增图标。
