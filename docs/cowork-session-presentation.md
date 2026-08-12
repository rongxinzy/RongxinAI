# 工作模式会话与执行过程展示

## 文档信息

| 项目 | 内容 |
| --- | --- |
| 适用模块 | 工作模式（Cowork） |
| 文档范围 | 侧边栏会话分组、流式执行过程、折叠展示 |
| 当前实现 | 前端实现，不新增后端字段或数据库表 |
| 定时会话识别 | 会话标题前缀 `[定时]`，兼容英文前缀 `[Cron]` |

## 1. 设计目标

工作模式同时承载普通工作会话和定时任务产生的会话。为了降低查找成本，侧边栏将两类会话分成两个一级区域：

```text
工作区
  项目 A
    普通会话 1
    普通会话 2

定时任务
  项目 A
    [定时]计算题
```

定时任务区域仍然按照工作区分组，因此同一个项目下的普通会话和定时会话可以分别查看，同时保留原有的工作区语义。

## 2. 侧边栏会话分组

### 2.1 识别规则

当前 `CoworkSessionSummary` 没有单独的会话来源字段，因此前端使用标题前缀进行识别：

| 标题示例 | 归属区域 |
| --- | --- |
| `[定时]计算题` | 定时任务 |
| `[Cron] daily report` | 定时任务 |
| `计算题` | 工作区 |
| `计算题 [定时]` | 工作区 |

识别逻辑使用 `startsWith`，只识别标题开头的前缀，不会把普通会话标题中间或结尾的文字误认为定时会话。

### 2.2 分组与交互

- `工作区`区域只展示非定时会话。
- `定时任务`区域只展示带定时前缀的会话。
- 两个区域都按 `workspaceId` 映射到工作区节点。
- 两个区域使用同一套会话行组件，支持选择、删除、重命名、置顶、分享和批量操作。
- 定时任务区域不显示新建普通会话按钮。
- 两个区域分别保存工作区展开状态和会话列表展开状态，互不干扰。
- 选择定时任务会话时，仍会先切换到该会话对应的工作区。

### 2.3 分页行为

侧边栏沿用现有的工作区会话分页接口和加载策略。一个工作区加载到的会话会先进入本地预览集合，再分别按标题前缀过滤到两个区域。

因此：

1. 普通会话和定时会话不会重复显示同一个会话。
2. “展开更多”仍然加载该工作区的下一页数据。
3. 定时任务区域只显示当前已加载页面中存在定时会话的工作区，避免显示空的工作区节点。

当前实现仍依赖标题前缀。如果用户重命名定时会话并删除 `[定时]` 或 `[Cron]` 前缀，该会话会被归入普通工作区区域。这是前端-only 方案的已知限制；若需要支持任意重命名，应由后端在会话摘要中增加 `sessionKind` 或 `isScheduledTask` 字段。

## 3. 流式执行过程展示

### 3.1 展示状态

| 阶段 | 界面结构 | 默认状态 |
| --- | --- | --- |
| final answer 尚未完成 | 多个“执行步骤”折叠组，中间 answer 按顺序显示 | 执行步骤收起 |
| 当前 turn 流式结束 | 一个“任务完成”折叠组，final answer 单独显示 | 任务完成收起 |

流式阶段的内容顺序如下：

```text
执行步骤（收起）
中间 answer
执行步骤（收起）
中间 answer
...
执行步骤（收起）

任务完成（收起）
final answer
```

### 3.2 执行步骤

“执行步骤”组可以包含：

- thinking 内容；
- tool 调用及其结果；
- 无法配对的 tool result；
- system 信息。

执行组展开后直接显示其内容。工具卡片保留自身的展开控制，避免展开外层执行组时自动展开每个工具的详细参数和输出。

### 3.3 任务完成

“任务完成”组包含 final answer 之前的全部可见内容，并保持原始顺序：

- tool；
- thinking；
- 中间 answer；
- tool result 和 system 信息。

该组不再嵌套“执行步骤”，展开后直接渲染上述内容。final answer 位于任务完成组之后，保持正文展示和复制操作。

为了避免中间 answer 在下一步 tool 到来前被误判为 final answer，只有当前 turn 的流式状态结束，并且最后一个显示组确实是非 thinking 的 assistant answer 时，才进入“任务完成”状态。

### 3.4 文案与折叠控件

- 中文文案：`执行步骤`、`任务完成`。
- 英文文案：`Execution steps`、`Task completed`。
- 折叠控件使用 AI Elements 的 `ChainOfThought`、`ChainOfThoughtHeader` 和 `ChainOfThoughtContent`。
- 标题与展开箭头紧邻显示，不再将箭头推到整行最右侧。
- thinking 使用 AI Elements 的 `Reasoning`，tool 使用项目现有的 `ToolCard`。

## 4. 实现文件

| 文件 | 职责 |
| --- | --- |
| `src/renderer/components/agentSidebar/MyAgentSidebarTree.tsx` | 渲染工作区和定时任务两个一级区域 |
| `src/renderer/components/agentSidebar/useWorkspaceSidebarState.ts` | 加载、过滤、分组和持久化两套展开状态 |
| `src/renderer/components/agentSidebar/WorkspaceTreeNode.tsx` | 复用工作区节点并控制定时区域按钮显示 |
| `src/renderer/components/agentSidebar/constants.ts` | 定时标题前缀与识别函数 |
| `src/renderer/components/agentSidebar/types.ts` | 侧边栏展开状态类型 |
| `src/renderer/components/cowork/CoworkSessionDetail.tsx` | 将当前 turn 的流式状态传给展示组件 |
| `src/renderer/components/cowork/components/TurnBlock.tsx` | 执行组、任务完成组和 final answer 的展示逻辑 |
| `src/renderer/components/cowork/components/ToolCard.tsx` | 执行工具卡片的折叠展示 |
| `src/shared/components/ai-elements/chain-of-thought.tsx` | AI Elements 折叠标题与箭头布局 |
| `src/renderer/services/i18n.ts` | 中英文界面文案 |

## 5. 兼容性说明

- 不修改 `cowork_sessions`、`cowork_messages` 或定时任务存储结构。
- 不新增 IPC 通道，不改变会话加载接口。
- 旧的 `workspaceSidebar.state` 数据仍可读取；新增的定时区域展开字段为可选字段。
- 旧会话标题不带定时前缀时，会按普通工作区会话处理。
- 英文界面创建的 `[Cron]` 会话仍能被定时任务区域识别。

## 6. 验证方式

在项目根目录执行：

```bash
npm run build:tsc
npx eslint src/renderer/components/cowork/components/TurnBlock.tsx src/renderer/components/cowork/components/ToolCard.tsx
npx vitest run src/renderer/components/cowork
```

重点验收场景：

1. 同一工作区同时存在普通会话和 `[定时]` 会话时，两者分别显示在两个一级区域。
2. 重启应用后，两个区域的展开状态保持不变。
3. tool/thinking 后出现中间 answer 时，不显示“任务完成”。
4. final answer 完成后，前置内容统一进入一个默认收起的“任务完成”组。
5. 展开“任务完成”时，不出现嵌套的“执行步骤”标题。
6. 展开执行步骤时，工具卡片仍保持自身折叠行为。
