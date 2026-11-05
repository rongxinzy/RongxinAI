# 知远智能体 (ZhiYuan Agent) · 全产品 UI 表面盘点清单 (UI Inventory)

> **版本**：v4.0.0 (Quiet Studio)  
> **审计日期**：2026-11-05  
> **数据源**：`src/renderer/` 源码、`src/shared/components/`、`DESIGN.md` (v4.0 Quiet Studio)、`AGENTS.md`  
> **定位**：全量盘点知远智能体桌面端全部 52 个核心视图与交互组件，记录文件路径、Props 契约、状态依赖、交互变体以及 Quiet Studio v4.0 规范合规评估，作为生产级 Figma 设计体系与前端工程落地的权威索引。

---

## 一、UI 表面架构与分域概览

知远智能体基于 Electron + React 本地优先架构构建，采用 **Quiet Studio v4.0** 统一设计标准：
- **一屏一个重心**：首屏重心在主输入岛，会话重心在执行流，设置重心在表单，杜绝多重心与高饱和装饰。
- **用面分区，不用线**：窗口底色（Level 0）、主面板（Level 1，8px 边距，12px 圆角，1px 细边框）、抬升表面（Level 2）、浮层（Level 3），不使用硬垂直分割线。
- **品牌色只表示「可执行」**：品牌蓝（`#3D70E0`）严格仅用于可执行主动作（发送、确认）、焦点环与运行标记，导航与普通控件使用中性色。
- **统一 32px 规格**：按钮、输入框、导航行、胶囊、操作行统一为 32px 高度、8px 圆角、16px 图标。

全产品分为 7 大核心域，共 52 个标准资产组件：

```
+---------------------------------------------------------------------------------------------------+
| 域 1: 主外壳与导航系统 (Shell & Navigation) - 8 个组件                                            |
| App | MainViewCanvas | Sidebar | SidebarNavigationView | WindowTitleBar | PageHeader ...          |
+---------------------------------------------------------------------------------------------------+
| 域 2: Cowork 工作区与执行流 (Cowork Workspace) - 17 个组件                                        |
| CoworkView | CoworkPromptInput | WorkspaceSelector | ModelPicker | ToolCard | TurnBlock ...       |
+---------------------------------------------------------------------------------------------------+
| 域 3: Artifacts 工件预览与沙箱 (Artifacts Sandbox) - 9 个组件                                     |
| ArtifactPanel | ArtifactRenderer | HtmlRenderer | CodeRenderer | SvgRenderer | MermaidRenderer ...|
+---------------------------------------------------------------------------------------------------+
| 域 4: 本地推理与模型体系 (Local Inference & Model System) - 5 个组件                              |
| LocalInferenceView | ModelsPanel | MarketplacePanel | ModelInspectorSidebar | DownloadSidebar     |
+---------------------------------------------------------------------------------------------------+
| 域 5: 设置中心 (Settings Center) - 6 个组件                                                       |
| SettingsPage | ModelSettingsPanel | GeneralSettingsPanel | AppearanceSettingsPanel ...            |
+---------------------------------------------------------------------------------------------------+
| 域 6: 模态弹窗与浮层系统 (Modal & Dialog System) - 3 个核心组件                                   |
| EditProjectDialog (标杆) | DestructiveConfirmDialog | CoworkPermissionModal                       |
+---------------------------------------------------------------------------------------------------+
| 域 7: 专有功能视图 (Specialized Views) - 4 个组件                                                 |
| ScheduledTasksView | ActivityView | SkillsManager | McpManager                                    |
+---------------------------------------------------------------------------------------------------+
```

---

## 二、全量 52 个组件详尽盘点

### 域 1：主外壳与导航系统 (Shell & Navigation)

#### 01. `App`
- **文件路径**：`src/renderer/App.tsx`
- **功能定位**：渲染进程根组件，负责 Redux Provider、主题初始化、全局快捷键、窗口事件与应用就绪生命周期。
- **Key Props 契约**：无（应用顶层入口）
- **状态依赖**：
  - Redux：`cowork`, `chat`, `workMode`, `window`, `settings`
  - Electron IPC：`window.electron.cowork.*`, `window.electron.theme.*`
  - 本地状态：`bootstrapReady`, `edition` ('standard' | 'enterprise')
- **交互状态变体**：
  - `Default`：正常工作视口，加载侧栏与主画布
  - `Loading`：首启骨架屏与环境探针检测态
  - `Error / Fallback`：未捕获异常崩溃遮罩与重启引导
- **Quiet Studio v4.0 合规度**：**合规 (A)**。作为纯容器无自造视觉样式，全局挂载 `--zy-surface` 窗口底色。

#### 02. `MainViewCanvas`
- **文件路径**：`src/renderer/app/MainViewCanvas.tsx`
- **功能定位**：主内容面板容器，呈现距窗口边缘 8px、12px 圆角、1px 细边框的中性抬升面板 (`theme-main-panel`)。
- **Key Props 契约**：
  - `mainView: SidebarActiveView`
  - `isSidebarCollapsed: boolean`
  - `onToggleSidebar: () => void`
- **状态依赖**：
  - Redux：`cowork.currentSessionId`, `localInference.runningModels`
  - 保活控制器：对 Cowork、LocalInference 与 CodingWorkbench 进行 DOM 保活
- **交互状态变体**：
  - `Default`：12px 圆角抬升面板，背景 `--zy-background`，边框 `--zy-border`，`shadow-xs`
  - `Resizing`：侧栏宽度调整时无过渡拖拽
  - `Fullscreen`：工件最大化或代码全屏态
- **Quiet Studio v4.0 合规度**：**合规 (A)**。完美对齐「用面分区，不用线」与 8px 边距规范。

#### 03. `Sidebar`
- **文件路径**：`src/renderer/components/Sidebar.tsx`
- **功能定位**：应用全局主导航侧边栏，宽度 260px（支持 220–420px 拖拽调节），整合模式切换、快捷动作、功能路由与项目任务树。
- **Key Props 契约**：
  - `activeView: SidebarActiveView`
  - `isCollapsed: boolean`
  - `onToggleCollapse: () => void`
  - `onNewChat: () => void`
  - `onShowSettings: () => void`
- **状态依赖**：
  - Redux：`cowork.sessions`, `cowork.chatSessions`, `workMode.workMode`
  - 本地状态：`sidebarWidth` (260px), `isResizing`, `isBatchMode`, `selectedIds`
- **交互状态变体**：
  - `Default (Expanded)`：宽度 260px，放置于窗口底色 `--zy-surface` 上，无垂直分割硬线
  - `Collapsed`：挂载 `inert` 属性，快捷键 Cmd/Ctrl+B 唤醒
  - `Resizing`：右侧 3px 拖拽把手激活，呈现 1px 品牌蓝竖线指示
  - `Batch Mode`：底部滑出中性抬升批量操作面板，带全选与危险删除
- **Quiet Studio v4.0 合规度**：**部分对齐 (A-)**。结构与几何标准完全对齐；遗留代码中存在个别常显时间戳，正逐步收归 hover 槽位。

#### 04. `SidebarNavigationView`
- **文件路径**：`src/renderer/components/shell/SidebarNavigationView.tsx`
- **功能定位**：侧栏头部核心控件区，承载工作/对话模式分段切换、36px 新建任务按钮、32px 全局搜索触发与固定功能入口。
- **Key Props 契约**：
  - `isChat: boolean`
  - `newConversation: () => void`
  - `entries: NavigationEntry[]`
  - `search: { query: string; onOpen: () => void }`
- **状态依赖**：本地乐观切换 `optimisticIsChat`
- **交互状态变体**：
  - `Mode Switch Default`：32px 高度，轨道 `--sidebar-accent`，滑块 `--card` 带 `shadow-xs`，文字 14px/500，严禁使用品牌蓝
  - `New Task Button Default`：36px 高度，`variant="secondary"`，中性抬升表面，右侧常显 `Ctrl N`
  - `New Task Button Hover`：边框加深至 `--zy-input-border`，阴影保持轻微
  - `Nav Row Hover`：背景换中性表面 `--accent`，文字主色
  - `Nav Row Active`：背景 `--sidebar-accent`，文字主色 + 500 字重
  - `Nav Row Running`：右侧常显 6px 品牌蓝实心圆点
- **Quiet Studio v4.0 合规度**：**合规 (A+)**。Quiet Studio 标杆级实现，完全废除渐变与高饱和填充。

#### 05. `WindowTitleBar`
- **文件路径**：`src/renderer/components/window/WindowTitleBar.tsx`
- **功能定位**：跨平台无边框窗口顶栏，提供拖拽区、双击最大化、Windows 标准最小化/最大化/关闭按钮。
- **Key Props 契约**：
  - `inline?: boolean`
  - `isOverlayActive?: boolean`
- **状态依赖**：Electron IPC `window.electron.windowState` (isMaximized, isFocused)
- **交互状态变体**：
  - `macOS`：自动让出左侧 68px 交通灯留白，标题居中或左侧对齐
  - `Windows Default`：右侧 3 个 36×28px、6px 圆角控制键，中性微弱底
  - `Windows Hover`：最小化/还原背景为 `--accent`；关闭按钮 hover 为危险色 `#D92D20`，图标变白
  - `Inactive Window`：窗口失焦时透明度降为 0.7
- **Quiet Studio v4.0 合规度**：**合规 (A)**。严谨适配双平台规范。

#### 06. `PageHeader`
- **文件路径**：`src/renderer/components/PageHeader.tsx`
- **功能定位**：所有主工作区页面的标准顶栏，高度 48px，内边距 16px，统筹折叠控制、单一页面标题、操作槽位与标签页。
- **Key Props 契约**：
  - `title?: React.ReactNode`
  - `leftContent?: React.ReactNode`
  - `actions?: React.ReactNode`
  - `tabs?: React.ReactNode`
  - `divider?: boolean`
- **状态依赖**：侧栏折叠状态、macOS 平台特性判断
- **交互状态变体**：
  - `Default`：高度 48px，主标题 14px / 500 字重，正文区禁止重复出现同名大标题
  - `Collapsed Action Hover`：展开/新建图标 28px 规格，hover 变中性底
  - `With Tabs`：第二行挂载下划线指示器 `PageTabs`，高度增为 80px
- **Quiet Studio v4.0 合规度**：**合规 (A+)**。全仓页面顶栏单一事实来源。

#### 07. `MyAgentSidebarTree`
- **文件路径**：`src/renderer/components/agentSidebar/MyAgentSidebarTree.tsx`
- **功能定位**：工作区项目文件夹与会话树形管理容器，支持项目折叠、新建会话、会话拖拽排序与批量操作。
- **Key Props 契约**：
  - `isBatchMode: boolean`
  - `selectedIds: Set<string>`
  - `workMode: 'work' | 'chat'`
- **状态依赖**：Redux `workspace.workspaces`, `cowork.sessions`
- **交互状态变体**：
  - `Folder Expanded / Collapsed`：Chevron 图标平滑 90° 旋转，子会话列表自然展开
  - `Folder Hover`：右侧浮现 24px「+」新建会话按钮与更多选项菜单
  - `Drag Over`：高亮 2px 品牌蓝水平指示线或文件夹浅蓝弱底高亮
- **Quiet Studio v4.0 合规度**：**合规 (A)**。无嵌套多余卡片，采用轻量行式树形结构。

#### 08. `AgentTaskRow`
- **文件路径**：`src/renderer/components/agentSidebar/AgentTaskRow.tsx`
- **功能定位**：侧边栏单个会话任务行，32px 统一行高，带状态图标、标题省略、相对时间与更多操作菜单。
- **Key Props 契约**：
  - `task: AgentSession`
  - `isSelected: boolean`
  - `isBatchMode: boolean`
  - `onRename: (id: string, title: string) => void`
  - `onDelete: (id: string) => void`
- **状态依赖**：本地状态 `isRenaming`, `menuOpen`
- **交互状态变体**：
  - `Idle`：背景透明，文字 `--zy-text-secondary`，相对时间隐藏
  - `Hover`：背景 `--accent`，文字 `--zy-text-primary`，右侧槽位平滑淡入相对时间与更多菜单图标
  - `Selected`：背景 `--sidebar-accent`，文字主色 + 500 字重，右侧可常显运行中蓝色点
  - `Renaming`：内联嵌入 28px `Input`，按 Enter 确认，Escape 取消
  - `Batch Select`：左侧呈现 16px 复选框，支持单选与多选
- **Quiet Studio v4.0 合规度**：**合规 (A)**。严格贯彻「相对时间按需显现」与 32px 规范。

---

### 域 2：Cowork 工作区与执行流 (Cowork Workspace)

#### 09. `CoworkView`
- **文件路径**：`src/renderer/components/cowork/CoworkView.tsx`
- **功能定位**：Cowork 智能体顶层视图，根据会话状态平滑切换「首页空白引导态」与「活跃会话工作台」。
- **Key Props 契约**：
  - `onRequestAppSettings: () => void`
  - `isSidebarCollapsed: boolean`
- **状态依赖**：Redux `cowork.currentSessionId`, `cowork.sessions`, `workMode.workMode`
- **交互状态变体**：
  - `Empty State`：垂直居中偏上布局，时段问候语（24px/600）+ 主输入岛（768px）+ 6 颗快捷引导胶囊
  - `Active Session`：顶满主面板，双栏自适应分流（对话执行流 + 工件预览抽屉）
- **Quiet Studio v4.0 合规度**：**合规 (A+)**。主界面 Quiet Studio v4.0 旗舰标杆。

#### 10. `CoworkPromptInput`
- **文件路径**：`src/renderer/components/cowork/CoworkPromptInput.tsx`
- **功能定位**：核心输入岛容器，最大宽度 768px，20px 大圆角，集成附件列表、多行输入、权限模式、工作区选择与圆形发送键。
- **Key Props 契约**：
  - `onSubmit: (text: string, files: File[]) => void`
  - `onStop: () => void`
  - `isStreaming: boolean`
  - `size?: 'large' | 'compact'`
- **状态依赖**：Redux `cowork.draftPrompts`, 本地附件列表, 当前工作区
- **交互状态变体**：
  - `Resting (Default)`：圆角 20px，背景 `--card`，边框 1px `--zy-input-border`，阴影 `shadow-sm`
  - `Focused (:focus-within)`：边框混合品牌蓝，阴影过渡升为 `shadow-md`（120ms）
  - `Drag Active`：文件拖入视口时触发中性虚线高亮与覆盖层
  - `Submit Disabled`：输入框为空时，32px 发送键为禁用态，光标 `not-allowed`，提示「请输入任务内容」
  - `Submit Ready`：输入有内容，发送键变为品牌蓝背景白箭头，hover 加深
  - `Streaming`：发送键变为停止图标（正方形）
- **Quiet Studio v4.0 合规度**：**合规 (A+)**。彻底消除渐变与毛玻璃，严格遵循 120ms 阴影微过渡。

#### 11. `PromptWorkspaceSelector`
- **文件路径**：`src/renderer/components/cowork/PromptWorkspaceSelector.tsx`
- **功能定位**：输入岛底部工作区目录选择芯片，32px 高度，指示智能体文件读写与命令执行的上下文边界。
- **Key Props 契约**：
  - `onSelectFolder: (path: string) => void`
  - `initialDirectory?: string`
  - `compact?: boolean`
- **状态依赖**：Redux `workspace.activeWorkspace`, 本地 Popover 状态
- **交互状态变体**：
  - `Default`：32px 高度，无边框，展示文件夹图标与目录名称，文字 14px
  - `Hover`：背景浅层中性填充 `--accent`
  - `Warning (Missing Path)`：显示黄色警告图标与「工作区不存在」提示
  - `Popover Open`：弹出 320px 浮层，支持最近项目直选与唤起系统原生选择对话框
- **Quiet Studio v4.0 合规度**：**合规 (A)**。

#### 12. `PermissionModeMenu`
- **文件路径**：`src/renderer/components/cowork/PermissionModeMenu.tsx`
- **功能定位**：输入岛底部权限安全策略选择菜单，32px 规格，管控 Bash 执行与写文件权限。
- **Key Props 契约**：
  - `value: 'prompt' | 'approve' | 'deny'`
  - `onChange: (mode: PermissionMode) => void`
  - `compact?: boolean`
- **状态依赖**：`config.permissionMode`
- **交互状态变体**：
  - `Default (Prompt)`：展示盾牌图标与「敏感操作需确认 (默认)」文案
  - `Approve All`：展示开启状态文案「全部自动放行 (极速)」
  - `Read Only`：展示锁定状态文案「完全只读模式 (沙箱)」
  - `Open`：下拉浮层展示三档详细安全说明与当前选中勾选标记
- **Quiet Studio v4.0 合规度**：**合规 (A)**。文案与安全状态完全对齐。

#### 13. `CoworkModelPicker`
- **文件路径**：`src/renderer/components/cowork/CoworkModelPicker.tsx`
- **功能定位**：输入岛右下角模型选择器，展示当前模型标识与上下文用量，支持快速切模与本地模型拉起。
- **Key Props 契约**：
  - `models: ModelOption[]`
  - `selectedModel: string`
  - `onSelect: (modelId: string) => void`
- **状态依赖**：Redux `availableModels`, 本地 GGUF 状态
- **交互状态变体**：
  - `Default`：32px 高度，展示模型名与上下文消耗微环，次级文字
  - `Hover`：中性弱底 `--accent`
  - `Menu Open`：弹出 Command 风格浮层，支持快速搜索过滤
  - `Local Model Inactive`：现存代码存在置灰断层，M3 重构后支持原地一键加载
- **Quiet Studio v4.0 合规度**：**重构对齐中 (B+)**。外观规格合规；会话原地拉起交互待 M3/Phase 2 落地。

#### 14. `PromptPlusMenu`
- **文件路径**：`src/renderer/components/cowork/PromptPlusMenu.tsx`
- **功能定位**：输入岛左侧「+」扩展能力入口，32px 规格，呼出添加文件、选择专家、挂载技能与 MCP 的菜单。
- **Key Props 契约**：
  - `onAddFile: () => void`
  - `onManageSkills: () => void`
  - `experts: ExpertProfile[]`
- **状态依赖**：本地 Popover 开关
- **交互状态变体**：
  - `Default`：圆形/圆角中性 32px 按钮，灰度「+」图标
  - `Hover`：背景 `--accent`，图标变为主文字色
  - `Open`：背景 `--sidebar-accent`，浮出 220px 功能分组列表
- **Quiet Studio v4.0 合规度**：**合规 (A)**。

#### 15. `QuickActionBar`
- **文件路径**：`src/renderer/components/quick-actions/QuickActionBar.tsx`
- **功能定位**：首页输入岛下方的 6 颗预设快捷引导胶囊，降低新用户冷启动门槛。
- **Key Props 契约**：
  - `actions: QuickActionItem[]`
  - `onActionSelect: (prompt: string) => void`
- **状态依赖**：无全局依赖，纯受控组件
- **交互状态变体**：
  - `Default`：统一 32px 高度、全圆角（`radius-full`）、1px 细边框 `--zy-border`、14px 次文字色
  - `Hover`：中性填充 `--accent`，文字变为主色，图标同步高亮，无阴影
  - `Active / Pressed`：`translateY(1px)`，微动效 120ms
- **Quiet Studio v4.0 合规度**：**合规 (A+)**。动宾短语（制作幻灯片、分析数据、搭建网站、深度调研、学术研究、撰写文档）严格统一。

#### 16. `CoworkSessionViewport`
- **文件路径**：`src/renderer/components/cowork/CoworkSessionViewport.tsx`
- **功能定位**：会话视口外壳，处理会话数据加载、流式订阅初始化与错误边界。
- **Key Props 契约**：
  - `sessionId: string`
  - `permissionMode: PermissionMode`
  - `onContinue: () => void`
- **状态依赖**：Redux `cowork.loadingSessionId`, `cowork.currentSession`
- **交互状态变体**：
  - `Loading`：骨架屏淡入，消息列脉冲占位
  - `Ready`：挂载会话明细与工件联动容器
  - `Resyncing`：网络或引擎重连时的静默刷新态
- **Quiet Studio v4.0 合规度**：**合规 (A)**。

#### 17. `CoworkSessionLayout`
- **文件路径**：`src/renderer/components/cowork/CoworkSessionLayout.tsx`
- **功能定位**：执行态双栏布局管理器，协调左侧消息流与右侧工件面板的宽度配比与全屏切换。
- **Key Props 契约**：
  - `title: string`
  - `isArtifactPanelOpen: boolean`
  - `children: React.ReactNode`
- **状态依赖**：本地 `activeView` ('conversation' | 'trace')
- **交互状态变体**：
  - `Single Column`：工件关闭时消息流 `max-w-4xl` 居中（896px）
  - `Split Pane`：工件打开时左侧占比 55%，右侧占比 45%
  - `Trace Mode`：切换为全宽任务轨迹审计树
- **Quiet Studio v4.0 合规度**：**合规 (A)**。

#### 18. `CoworkSessionDetail`
- **文件路径**：`src/renderer/components/cowork/CoworkSessionDetail.tsx`
- **功能定位**：会话主操作面，组装虚拟化消息流、悬浮运行状态、底部附着输入框与审批弹层。
- **Key Props 契约**：
  - `onContinue: () => void`
  - `onStop: () => void`
  - `inlinePermission: boolean`
- **状态依赖**：Redux `cowork.streamingSessionIds`, `cowork.currentSession`
- **交互状态变体**：
  - `Streaming Running`：底部显示暂停/继续控制，流式自动贴底滚动
  - `User Scrolled Up`：用户向上滚动时停止强制贴底，右下角浮现「回到底部」胶囊
  - `Finished`：消息流终态，底部输入岛重新变为就绪态
- **Quiet Studio v4.0 合规度**：**合规 (A)**。

#### 19. `VirtualizedTurnList`
- **文件路径**：`src/renderer/components/cowork/components/VirtualizedTurnList.tsx`
- **功能定位**：高频流式消息的虚拟化列表引擎，保障上千轮长会话 60fps 流畅滚动。
- **Key Props 契约**：
  - `turns: TurnData[]`
  - `isStreaming: boolean`
  - `sessionId: string`
- **状态依赖**：动态计算可视高度与滚动偏移量
- **交互状态变体**：
  - `Idle Scrolling`：平滑惯性滚动，视口外节点卸载
  - `Streaming Tail`：增量 Chunk 追加时单点 coalescing 合并渲染，无全量重绘
- **Quiet Studio v4.0 合规度**：**合规 (A)**。

#### 20. `TurnBlock`
- **文件路径**：`src/renderer/components/cowork/components/TurnBlock.tsx`
- **功能定位**：单个交互轮次容器，组合 UserBubble、ThinkingItem、ToolCard 序列与 AssistantBubble。
- **Key Props 契约**：
  - `turn: TurnData`
  - `isLastTurn: boolean`
  - `onRespondToPermission: (id: string, allow: boolean) => void`
- **状态依赖**：`LiveTextStore` 流式文本缓存
- **交互状态变体**：
  - `User Bubble`：中性表面抬升，靠右对齐或整行，14px 正文，附件缩略图
  - `Assistant Bubble`：无底色直接排版在画布上，基于 StreamingMarkdownResponse 打字机输出
  - `Thinking Item`：高度 36px，左侧贯穿中性细线，流式微光动效，完成固定耗时
- **Quiet Studio v4.0 合规度**：**合规 (A)**。

#### 21. `ToolCard`
- **文件路径**：`src/renderer/components/cowork/components/ToolCard.tsx`
- **功能定位**：工具执行卡片，展示 Bash、文件读写、网络请求等原子工具的入参、状态与返回结果。
- **Key Props 契约**：
  - `group: ToolExecutionGroup`
  - `pendingPermission?: PermissionRequest`
  - `onRespondToPermission?: (allow: boolean) => void`
- **状态依赖**：本地展开状态持久化 `usePersistentToggle`
- **交互状态变体**：
  - `Running`：左侧蓝色旋转指示器，紧凑 32px 头部，展示工具名与参数摘要
  - `Success`：绿色成功图标，耗时标签，内容默认折叠
  - `Error`：红色警告图标，直接展开错误堆栈，提供重试建议
  - `Expanded`：展开展示完整命令行或格式化 JSON 入参与终端输出
- **Quiet Studio v4.0 合规度**：**合规 (A)**。消除所有毛玻璃卡片与彩色外发光。

#### 22. `AskUserQuestionCard`
- **文件路径**：`src/renderer/components/cowork/AskUserQuestionCard.tsx`
- **功能定位**：智能体中断向导卡片，当执行遇到歧义时由模型主动唤起，向用户收集结构化决策。
- **Key Props 契约**：
  - `permission: AskUserQuestionData`
  - `onRespond: (answers: Record<string, any>) => void`
- **状态依赖**：本地表单输入状态 `answers`
- **交互状态变体**：
  - `Default (Unanswered)`：嵌入消息流中与气泡同宽，支持单选 Radio、多选 Checkbox、文本 Input
  - `Validation Error`：未填必填项时红色高亮文字提示
  - `Submitting`：确认按钮进入 Loading 态，表单输入锁定
- **Quiet Studio v4.0 合规度**：**合规 (A)**。表单字段间距 16px，文字 ≥14px，对齐弹窗密度基准。

#### 23. `WorkbenchTaskAcceptanceCard`
- **文件路径**：`src/renderer/components/cowork/WorkbenchTaskAcceptanceCard.tsx`
- **功能定位**：任务交付与用户验收卡片，呈现最终交付物清单与代码/工件成果。
- **Key Props 契约**：`sessionId: string`
- **状态依赖**：`window.electron.workbenchTask`
- **交互状态变体**：
  - `Pending Review`：中性边框，展示「待验收」Badge、交付物链接清单、耗时统计
  - `Accept Action`：32px 品牌蓝主按钮「确认验收通过」
  - `Reject Action`：32px 次级按钮「提出修改要求」
- **Quiet Studio v4.0 合规度**：**合规 (A)**。

#### 24. `WorkbenchTaskTrajectory`
- **文件路径**：`src/renderer/components/cowork/WorkbenchTaskTrajectory.tsx`
- **功能定位**：会话审计模式下的全链路轨迹树视图（Trace Tab），展示全量工具树与决策步骤。
- **Key Props 契约**：
  - `sessionId: string`
  - `active: boolean`
  - `onBackToConversation: () => void`
- **状态依赖**：Redux `activity.runs`
- **交互状态变体**：
  - `Tree View Default`：树形节点展开，支持按步骤折叠/展开
  - `Node Focus`：高亮选中步骤的代码与环境变量快照
- **Quiet Studio v4.0 合规度**：**合规 (A)**。

#### 25. `SessionStatsLine`
- **文件路径**：`src/renderer/components/cowork/SessionStatsLine.tsx`
- **功能定位**：执行性能指标指示栏，展示 Token 消耗、生成吞吐（tokens/s）、执行轮数与缓存命中率。
- **Key Props 契约**：`messages: UIMessage[]`
- **状态依赖**：计算每轮 Token 元数据
- **交互状态变体**：
  - `Resting`：右下角极简 12px 元信息展示
  - `Hover / Click`：展开 Popover 展示提示词/补全 Token 拆解明细与推理耗时
- **Quiet Studio v4.0 合规度**：**合规 (A)**。

---

### 域 3：Artifacts 工件预览与沙箱 (Artifacts Sandbox)

#### 26. `ArtifactPanel`
- **文件路径**：`src/renderer/components/artifacts/ArtifactPanel.tsx`
- **功能定位**：工件主视口面板，支持右侧分栏（45%）、全屏查看、工作区模式与拖拽调宽。
- **Key Props 契约**：
  - `artifacts: ArtifactItem[]`
  - `panelWidth: number`
  - `onResizeFrame: (width: number) => void`
- **状态依赖**：Redux `artifacts.activeTab`, `artifacts.layoutMode`
- **交互状态变体**：
  - `Default Split`：宽度 ≥320px，左侧带 3px 拖拽把手
  - `Resizing`：把手呈现品牌蓝细线
  - `Fullscreen`：占满主面板视口，顶栏展示还原按钮
- **Quiet Studio v4.0 合规度**：**合规 (A)**。

#### 27. `ArtifactRenderer`
- **文件路径**：`src/renderer/components/artifacts/ArtifactRenderer.tsx`
- **功能定位**：工件多态动态派发器，按 MIME 类型或文件后缀异步懒加载专有渲染器。
- **Key Props 契约**：`artifact: ArtifactItem`
- **状态依赖**：React.lazy 异步加载状态
- **交互状态变体**：
  - `Loading`：骨架占位动画
  - `Resolved`：挂载对应沙箱渲染组件
  - `Unsupported / Error`：回退为通用文本或十六进制代码视图
- **Quiet Studio v4.0 合规度**：**合规 (A)**。

#### 28. `HtmlRenderer`
- **文件路径**：`src/renderer/components/artifacts/renderers/HtmlRenderer.tsx`
- **功能定位**：HTML 网页与交互式 React 单页应用独立沙箱预览器。
- **Key Props 契约**：`artifact: ArtifactItem`
- **状态依赖**：iframe 沙箱生命周期与跨域隔离事件
- **交互状态变体**：
  - `Iframe Sandboxed`：原生 `<iframe>` 挂载，隔离父级 DOM 与 LocalStorage
  - `Console Log Drawer`：底部可折叠日志视口，实时显示 iframe 内部的 console.log
- **Quiet Studio v4.0 合规度**：**合规 (A)**。严格安全隔离。

#### 29. `CodeRenderer`
- **文件路径**：`src/renderer/components/artifacts/renderers/CodeRenderer.tsx`
- **功能定位**：源码与脚本代码高亮查看器，支持 40+ 语言 Shiki 高亮。
- **Key Props 契约**：`artifact: ArtifactItem`
- **状态依赖**：Shiki 语言包初始化
- **交互状态变体**：
  - `Rendered`：等宽字体，双主题色自适应高亮，支持左侧行号
  - `Copy Action`：右上角 28px 一键复制代码按钮，点击后反馈「已复制」勾选
- **Quiet Studio v4.0 合规度**：**合规 (A)**。

#### 30. `SvgRenderer`
- **文件路径**：`src/renderer/components/artifacts/renderers/SvgRenderer.tsx`
- **功能定位**：SVG 矢量图形查看器，执行严格的 DOMPurify 消毒并居中自适应缩放。
- **Key Props 契约**：`artifact: ArtifactItem`
- **状态依赖**：DOMPurify 净化结果
- **交互状态变体**：
  - `Rendered`：透明网格棋盘底或纯色底，自适应保持宽高比
  - `Zoom / Pan`：支持鼠标滚轮放大与拖拽平移
- **Quiet Studio v4.0 合规度**：**合规 (A)**。

#### 31. `MermaidRenderer`
- **文件路径**：`src/renderer/components/artifacts/renderers/MermaidRenderer.tsx`
- **功能定位**：流程图、时序图、架构图与甘特图图表渲染引擎。
- **Key Props 契约**：`artifact: ArtifactItem`
- **状态依赖**：Mermaid 解析引擎（严格安全模式）
- **交互状态变体**：
  - `Rendering`：中性微光骨架
  - `Rendered`：矢量图表按主题变色
  - `Syntax Error`：友好错误提示面板，标示行号与语法错误位置
- **Quiet Studio v4.0 合规度**：**合规 (A)**。

#### 32. `ModelRenderer`
- **文件路径**：`src/renderer/components/artifacts/renderers/ModelRenderer.tsx`
- **功能定位**：3D 模型网格视口，支持 OBJ、STL 与 GLTF 模型预览。
- **Key Props 契约**：`artifact: ArtifactItem`
- **状态依赖**：Three.js WebGL 上下文
- **交互状态变体**：
  - `3D Canvas`：鼠标左键旋转轨道、右键平移、滚轮缩放
  - `Controls Overlay`：右上角视角重置、线框模式切换与光照调节
- **Quiet Studio v4.0 合规度**：**合规 (A)**。

#### 33. `DocumentRenderer`
- **文件路径**：`src/renderer/components/artifacts/renderers/DocumentRenderer.tsx`
- **功能定位**：PDF、Word (docx) 与 Excel (xlsx) 文档格式的内嵌解析查看器。
- **Key Props 契约**：`artifact: ArtifactItem`
- **状态依赖**：文档解析工作线程
- **交互状态变体**：
  - `Document Page`：分页浏览、页码跳转、缩放比例调节（50%~200%）
  - `Sheet View`：Excel 多 Sheet 标签页切换与表格数据虚拟滚动
- **Quiet Studio v4.0 合规度**：**合规 (A)**。

#### 34. `FileDirectoryView`
- **文件路径**：`src/renderer/components/artifacts/FileDirectoryView.tsx`
- **功能定位**：当前会话产出工件的多文件切换浮层与树形列表。
- **Key Props 契约**：
  - `artifacts: ArtifactItem[]`
  - `selectedId: string`
  - `onSelect: (id: string) => void`
- **状态依赖**：本地列表选中态
- **交互状态变体**：
  - `Row Hover`：背景中性填充 `--accent`，展示文件大小与生成时间
  - `Row Selected`：背景 `--sidebar-accent`，主文字色加粗
- **Quiet Studio v4.0 合规度**：**合规 (A)**。

---

### 域 4：本地推理与模型体系 (Local Inference & Model System)

#### 35. `LocalInferenceView`
- **文件路径**：`src/renderer/components/localInference/LocalInferenceView.tsx`
- **功能定位**：本地模型与量化推理独立主视图，统筹本地模型库、模型市场与全局引擎参数。
- **Key Props 契约**：
  - `isSidebarCollapsed: boolean`
  - `onOpenModelSettings: () => void`
- **状态依赖**：本地模型列表、运行状态轮询（5s）、市场下载队列
- **交互状态变体**：
  - `Tabs`：PageTabs 切换「本地模型」与「模型市场」
  - `Settings Menu`：右上角设置菜单呼出网络、显存与存储路径弹窗
- **Quiet Studio v4.0 合规度**：**存在割裂待重构 (B+)**。与设置中心模型配置存在双头管理。

#### 36. `ModelsPanel`
- **文件路径**：`src/renderer/components/localInference/panels/ModelsPanel.tsx`
- **功能定位**：已下载本地 GGUF 模型卡片列表，处理模型启动、停止、删除与详情检查。
- **Key Props 契约**：
  - `localModels: LocalModel[]`
  - `runningModels: RunningModel[]`
  - `onLoadModel: (model: LocalModel) => void`
- **状态依赖**：`cancellingModelLoad`, 启动 Loading 态
- **交互状态变体**：
  - `Stopped Card`：展示模型文件名、量化格式、大小，32px 边框按钮「启动」
  - `Loading Card`：按钮变为 Spinner，提供 32px「取消启动」
  - `Running Card`：现存代码违规包含 `BreathingDot` 2s 呼吸动画（待移除），提供 32px 危险按钮「停止」
  - `Inspector Open`：右侧滑出模型检查器抽屉
- **Quiet Studio v4.0 合规度**：**违规待整改 (B)**。`ModelsPanel.tsx:563` 存在呼吸动画禁令违规，需整改为静态语义点与行式列表。

#### 37. `MarketplacePanel`
- **文件路径**：`src/renderer/components/localInference/panels/MarketplacePanel.tsx`
- **功能定位**：模型市场发现与下载界面，集成设备硬件探测、任务类型筛选与兼容度匹配。
- **Key Props 契约**：
  - `models: MarketplaceModel[]`
  - `hardwareSummary: HardwareSummary`
  - `onInstall: (model: MarketplaceModel) => void`
- **状态依赖**：`marketplaceLoading`, `marketplaceError`, `fitFilter`
- **交互状态变体**：
  - `Hardware Banner`：展示 CPU、RAM、GPU 与可用 VRAM 水位
  - `Model Card`：展示模型星级、下载量、预估显存与「下载安装」动作
  - `Search Error Bug`：现存代码在无缓存时吞没错误（待修复），修复后展示清晰重试面板
- **Quiet Studio v4.0 合规度**：**逻辑缺陷待修复 (B+)**。

#### 38. `ModelInspectorSidebar`
- **文件路径**：`src/renderer/components/localInference/components/ModelInspectorSidebar.tsx`
- **功能定位**：模型检查器右侧抽屉，宽度 300–560px 可拖拽，配置上下文长度、GPU 卸载层数与查看日志。
- **Key Props 契约**：
  - `open: boolean`
  - `model?: LocalModel`
  - `runningModel?: RunningModel`
  - `onSave: (params: ModelParams) => void`
- **状态依赖**：活动 Tab ('overview' | 'settings' | 'logs')
- **交互状态变体**：
  - `Parameter Display`：现存代码存在窄屏下参数名截断，提案 26:1684 改为标签在上数值在下的分行排版
  - `Logs Tab`：实时输出 `llama-server` 进程标准输出与错误日志终端
- **Quiet Studio v4.0 合规度**：**排版偏紧待优化 (A-)**。

#### 39. `MarketplaceDownloadSidebar`
- **文件路径**：`src/renderer/components/localInference/components/MarketplaceDownloadSidebar.tsx`
- **功能定位**：模型下载任务抽屉，实时显示网络下载、分块校验与加载状态。
- **Key Props 契约**：
  - `visible: boolean`
  - `model?: MarketplaceModel`
  - `progress?: DownloadProgress`
  - `onCancel: () => void`
- **状态依赖**：IPC `onPullProgress` 实时推送
- **交互状态变体**：
  - `Downloading`：进度条指示已下载字节/总大小，实时网速与剩余时间
  - `Verifying`：校验 SHA256 完整性
  - `Cancel Action`：提供 32px 中性取消按钮
- **Quiet Studio v4.0 合规度**：**合规 (A)**。

---

### 域 5：设置中心 (Settings Center)

#### 40. `SettingsPage`
- **文件路径**：`src/renderer/components/settings/SettingsPage.tsx`
- **功能定位**：应用设置中心全局容器，标准二栏架构（左侧 200px 导航列表，右侧单面分区表单区）。
- **Key Props 契约**：
  - `initialTab?: SettingsTab`
  - `onClose: () => void`
- **状态依赖**：全局配置服务 `configService`, 脏数据修改监听
- **交互状态变体**：
  - `Nav List`：高 32px 导航项，选中项中性表面 `--sidebar-accent`，文字主色 + 500 字重
  - `Form Surface`：右侧单面分区，字段间距 16px，文字 ≥14px
- **Quiet Studio v4.0 合规度**：**合规 (A)**。

#### 41. `ModelSettingsPanel`
- **文件路径**：`src/renderer/components/settings/model/ModelSettingsPanel.tsx`
- **功能定位**：设置中心模型配置，管理云端与本地供应商、默认模型路由与参数偏好。
- **Key Props 契约**：无（直接绑定 Magpie 与 Config）
- **状态依赖**：Magpie Providers 列表、`defaultModelId`
- **交互状态变体**：
  - `Providers List`：展示云端服务商状态与已配置模型
  - `Provider Edit Modal`：现存代码存在 14px 细碎按钮（`ProviderEditDialog.tsx:664-694`），提案 34:934 统一为 32px 行式列表
- **Quiet Studio v4.0 合规度**：**局部控件偏小待重构 (B)**。

#### 42. `GeneralSettingsPanel`
- **文件路径**：`src/renderer/components/settings/general/GeneralSettingsPanel.tsx`
- **功能定位**：常规系统设置（语言、开机自启、防休眠、代码模式、桌面宠物、数据库备份）。
- **Key Props 契约**：无
- **状态依赖**：`config.general`
- **交互状态变体**：
  - `Switch Rows`：36×20px 规范开关，高对比度轨道，切换即持久化
- **Quiet Studio v4.0 合规度**：**合规 (A)**。

#### 43. `AppearanceSettingsPanel`
- **文件路径**：`src/renderer/components/settings/appearance/AppearanceSettingsPanel.tsx`
- **功能定位**：外观主题设置，支持浅色、深色、跟随系统切换与动画减弱策略。
- **Key Props 契约**：无
- **状态依赖**：`themeService`
- **交互状态变体**：
  - `Theme Cards`：3 颗单选卡片，选中呈现 2px 品牌蓝外边框与 Check 徽标，原位热更新无白屏
- **Quiet Studio v4.0 合规度**：**合规 (A)**。

#### 44. `ManagedMemorySettings`
- **文件路径**：`src/renderer/components/settings/memory/ManagedMemorySettings.tsx`
- **功能定位**：智能体记忆管理，查看并检索项目、个人与会话记忆，支持逐条清理。
- **Key Props 契约**：无
- **状态依赖**：本地 Engram 运行时与 SQLite 投影
- **交互状态变体**：
  - `Search / Filter`：支持按作用域筛选记忆记录
  - `Delete Row`：调用统一 `DestructiveConfirmDialog` 执行不可逆清除
- **Quiet Studio v4.0 合规度**：**合规 (A)**。

#### 45. `IMSettings`
- **文件路径**：`src/renderer/components/im/IMSettings.tsx`
- **功能定位**：多渠道即时通讯 Bot 实例配置（微信、企业微信、钉钉、飞书、QQ、Telegram、Discord）。
- **Key Props 契约**：无
- **状态依赖**：各渠道实例网关状态与凭证
- **交互状态变体**：
  - `Channel Card`：每个渠道配有开关、连通性测试按钮与工作区绑定
- **Quiet Studio v4.0 合规度**：**合规 (A-)**。字段较多，均对齐 16px 舒展度。

---

### 域 6：模态弹窗与浮层系统 (Modal & Dialog System)

#### 46. `EditProjectDialog`
- **文件路径**：`src/renderer/components/agentSidebar/EditProjectDialog.tsx`
- **功能定位**：编辑项目弹窗，**全仓弹窗与表单密度金牌标杆 (Codex 基准)**。
- **Key Props 契约**：
  - `workspace?: Workspace`
  - `open: boolean`
  - `onOpenChange: (open: boolean) => void`
  - `onSave: (data: ProjectData) => void`
- **状态依赖**：本地表单数据与目录路径
- **交互状态变体**：
  - `Form Open`：宽度 512px (`sm:max-w-lg`)，字段间距 16px，文字 ≥14px，标签间距 6-8px
  - `Directory Pick`：系统文件夹选择与关联目录行式移除
  - `Save / Delete`：底部操作栏左侧危险删除，右侧中性取消与品牌蓝主确认
- **Quiet Studio v4.0 合规度**：**全仓标杆 (A+)**。

#### 47. `DestructiveConfirmDialog`
- **文件路径**：`src/shared/components/ui/destructive-confirm-dialog.tsx`
- **功能定位**：全仓统一不可逆危险删除确认弹窗，用于会话、模型、项目与数据的永久销毁。
- **Key Props 契约**：
  - `open: boolean`
  - `title: string`
  - `description: string`
  - `onConfirm: () => void`
  - `isConfirming?: boolean`
- **状态依赖**：纯受控组件
- **交互状态变体**：
  - `Open`：宽度 384px (`max-w-sm`)，红色警示图标，不可逆警告说明
  - `Buttons`：左侧 Ghost 变体取消，右侧 Destructive 红色填充按钮「确认删除」
- **Quiet Studio v4.0 合规度**：**合规 (A+)**。

#### 48. `CoworkPermissionModal`
- **文件路径**：`src/renderer/components/cowork/CoworkPermissionModal.tsx`
- **功能定位**：Cowork 运行敏感工具审批弹窗（Bash 命令行、文件覆写拦截）。
- **Key Props 契约**：
  - `permission: PermissionRequest`
  - `onRespond: (allow: boolean) => void`
- **状态依赖**：危险等级计算 `detectPermissionDanger`
- **交互状态变体**：
  - `Danger High`：红色边框与警告徽章，代码块展示待执行的具体 Shell 指令
  - `Action`：左侧「拒绝执行」，右侧「允许执行」
- **Quiet Studio v4.0 合规度**：**合规 (A)**。

---

### 域 7：专有功能视图 (Specialized Views)

#### 49. `ScheduledTasksView`
- **文件路径**：`src/renderer/components/scheduledTasks/ScheduledTasksView.tsx`
- **功能定位**：自动化计划任务中心，提供可视化 Cron 构建、任务清单与执行历史。
- **Key Props 契约**：`isSidebarCollapsed: boolean`
- **状态依赖**：Cron 任务列表与触发历史
- **交互状态变体**：
  - `Task Row`：高 32px 操作区，展示下次执行倒计时、启停开关与一键触发
- **Quiet Studio v4.0 合规度**：**合规 (A)**。

#### 50. `ActivityView`
- **文件路径**：`src/renderer/components/activity/ActivityView.tsx`
- **功能定位**：后台任务与多渠道消息执行流水线日志视图。
- **Key Props 契约**：
  - `isSidebarCollapsed: boolean`
  - `onShowScheduledTasks: () => void`
- **状态依赖**：Redux `activity.runs`
- **交互状态变体**：
  - `Timeline List`：按天折叠，顶部提供渠道与状态筛选胶囊
- **Quiet Studio v4.0 合规度**：**合规 (A)**。

#### 51. `SkillsManager`
- **文件路径**：`src/renderer/components/skills/SkillsManager.tsx`
- **功能定位**：智能体能力扩展技能中心，支持技能安装、静态安全审查与启用管理。
- **Key Props 契约**：
  - `readOnly?: boolean`
  - `onCreateByChat?: () => void`
- **状态依赖**：已安装技能列表、市场推荐技能
- **交互状态变体**：
  - `Security Audit Modal`：安装前弹出静态代码安全审计报告与权限清单
- **Quiet Studio v4.0 合规度**：**合规 (A)**。

#### 52. `McpManager`
- **文件路径**：`src/renderer/components/mcp/McpManager.tsx`
- **功能定位**：模型上下文协议 (Model Context Protocol) 连接器管理中心。
- **Key Props 契约**：
  - `onUseMcp?: (serverName: string) => void`
  - `openRegistryId?: string`
- **状态依赖**：已连接服务器列表、探测可用工具集
- **交互状态变体**：
  - `Connect Wizards`：提供官方直连、Token 授权、Stdio/SSE 自定义表单与 JSON 导入
- **Quiet Studio v4.0 合规度**：**合规 (A)**。

---

## 三、全产品 UI 表面盘点对照总表

| 序号 | 组件名称 | 相对路径 | 归属域 | 核心控件规格 | 交互变体覆盖 | 规范对齐等级 | 备注 / 落地说明 |
|:---|:---|:---|:---|:---|:---|:---|:---|
| 01 | `App` | `src/renderer/App.tsx` | Shell | 顶层根容器 | Default, Loading, Error | **A** | 全局窗口底色 `--zy-surface` 事实来源 |
| 02 | `MainViewCanvas` | `src/renderer/app/MainViewCanvas.tsx` | Shell | 8px 外距, 12px 圆角 | Default, Resizing, Fullscreen | **A** | 主面板用面分区抬升 |
| 03 | `Sidebar` | `src/renderer/components/Sidebar.tsx` | Shell | 260px 宽, 拖拽调节 | Default, Collapsed, Batch | **A-** | 相对时间正全面收归 hover 槽位 |
| 04 | `SidebarNavigationView` | `src/renderer/components/shell/SidebarNavigationView.tsx` | Shell | 32px 导航, 36px 新建 | Hover, Active, Focus, Running | **A+** | 模式切换采用中性色，无品牌色铺满 |
| 05 | `WindowTitleBar` | `src/renderer/components/window/WindowTitleBar.tsx` | Shell | 36×28px 控制键 | Hover, Pressed, Close-Danger | **A** | 适配 macOS 68px 交通灯留白与 Windows |
| 06 | `PageHeader` | `src/renderer/components/PageHeader.tsx` | Shell | 48px 统一高度 | Default, Nav-Hover, With-Tabs | **A+** | 顶栏单一标题，正文不重复大标题 |
| 07 | `MyAgentSidebarTree` | `src/renderer/components/agentSidebar/MyAgentSidebarTree.tsx` | Shell | 32px 树节点 | Expanded, Collapsed, Drag | **A** | 文件夹与会话轻量行式树形 |
| 08 | `AgentTaskRow` | `src/renderer/components/agentSidebar/AgentTaskRow.tsx` | Shell | 32px 行高, 16px 图标 | Idle, Hover, Selected, Rename | **A** | 相对时间仅 hover 显现，运行中蓝点常亮 |
| 09 | `CoworkView` | `src/renderer/components/cowork/CoworkView.tsx` | Cowork | 768px 输入岛, 24px 标题 | Empty State, Active Session | **A+** | Quiet Studio v4.0 主界面设计基准 |
| 10 | `CoworkPromptInput` | `src/renderer/components/cowork/CoworkPromptInput.tsx` | Cowork | 20px 圆角, 32px 控件 | Resting, Focused, Streaming | **A+** | 120ms 平滑升起 `shadow-md` |
| 11 | `PromptWorkspaceSelector` | `src/renderer/components/cowork/PromptWorkspaceSelector.tsx` | Cowork | 32px 高度, 8px 圆角 | Default, Hover, Warning, Popover | **A** | 工作区边界明确指示 |
| 12 | `PermissionModeMenu` | `src/renderer/components/cowork/PermissionModeMenu.tsx` | Cowork | 32px 胶囊菜单 | Prompt, Approve, ReadOnly | **A** | 默认敏感操作需确认 |
| 13 | `CoworkModelPicker` | `src/renderer/components/cowork/CoworkModelPicker.tsx` | Cowork | 32px 芯片, 8px 圆角 | Default, Hover, MenuOpen | **B+** | 待落地会话内零摩擦原地拉起本地模型 |
| 14 | `PromptPlusMenu` | `src/renderer/components/cowork/PromptPlusMenu.tsx` | Cowork | 32px 图标按钮 | Default, Hover, Open | **A** | 能力扩展统一入口 |
| 15 | `QuickActionBar` | `src/renderer/components/quick-actions/QuickActionBar.tsx` | Cowork | 32px 全圆胶囊 | Default, Hover, Pressed | **A+** | 6 颗动宾短语轻量引导项 |
| 16 | `CoworkSessionViewport` | `src/renderer/components/cowork/CoworkSessionViewport.tsx` | Cowork | 全高主视口 | Loading, Ready, Resyncing | **A** | 会话加载与错误边界 |
| 17 | `CoworkSessionLayout` | `src/renderer/components/cowork/CoworkSessionLayout.tsx` | Cowork | 55%:45% 分栏 | Single, Split, Trace | **A** | 双栏自适应与全屏切换 |
| 18 | `CoworkSessionDetail` | `src/renderer/components/cowork/CoworkSessionDetail.tsx` | Cowork | 贴底附着流 | Streaming, User-Scroll, Done | **A** | 消息流滚动与底部输入联动 |
| 19 | `VirtualizedTurnList` | `src/renderer/components/cowork/components/VirtualizedTurnList.tsx` | Cowork | 视口虚拟化 | Smooth Scroll, Coalescing | **A** | 长会话 60fps 滚动引擎 |
| 20 | `TurnBlock` | `src/renderer/components/cowork/components/TurnBlock.tsx` | Cowork | 交互轮次块 | User, Assistant, Thinking | **A** | 思考折叠块带中性贯穿线 |
| 21 | `ToolCard` | `src/renderer/components/cowork/components/ToolCard.tsx` | Cowork | 32px 紧凑头部 | Running, Success, Error | **A** | 废除毛玻璃与彩色外发光 |
| 22 | `AskUserQuestionCard` | `src/renderer/components/cowork/AskUserQuestionCard.tsx` | Cowork | 行内全宽向导 | Unanswered, Error, Submitting | **A** | 对齐弹窗舒展度与 16px 间距 |
| 23 | `WorkbenchTaskAcceptanceCard`| `src/renderer/components/cowork/WorkbenchTaskAcceptanceCard.tsx`| Cowork | 交付物卡片 | Pending, Accept, Reject | **A** | 任务收尾交付物验证 |
| 24 | `WorkbenchTaskTrajectory` | `src/renderer/components/cowork/WorkbenchTaskTrajectory.tsx` | Cowork | 全宽轨迹树 | Tree View, Step Focus | **A** | 任务审计历史 |
| 25 | `SessionStatsLine` | `src/renderer/components/cowork/SessionStatsLine.tsx` | Cowork | 12px 元信息 | Resting, Popover Open | **A** | Token 与吞吐性能展示 |
| 26 | `ArtifactPanel` | `src/renderer/components/artifacts/ArtifactPanel.tsx` | Artifacts | 40px 顶栏, 320px+ 宽 | Split, Resizing, Fullscreen | **A** | 工件预览主面板 |
| 27 | `ArtifactRenderer` | `src/renderer/components/artifacts/ArtifactRenderer.tsx` | Artifacts | 动态派发视口 | Loading, Resolved, Fallback | **A** | 代码分割异步加载 |
| 28 | `HtmlRenderer` | `src/renderer/components/artifacts/renderers/HtmlRenderer.tsx` | Artifacts | 隔离 iframe 沙箱 | Sandboxed, Logs Drawer | **A** | 跨域与 DOM 严格安全隔离 |
| 29 | `CodeRenderer` | `src/renderer/components/artifacts/renderers/CodeRenderer.tsx` | Artifacts | Shiki 高亮视口 | Highlight, Copy Action | **A** | 双色自适应高亮与行号 |
| 30 | `SvgRenderer` | `src/renderer/components/artifacts/renderers/SvgRenderer.tsx` | Artifacts | DOMPurify 净化视口 | Rendered, Zoom, Pan | **A** | 矢量图消毒与缩放平移 |
| 31 | `MermaidRenderer` | `src/renderer/components/artifacts/renderers/MermaidRenderer.tsx` | Artifacts | 严格安全图表 | Rendering, Rendered, Error | **A** | 流程图/时序图/甘特图渲染 |
| 32 | `ModelRenderer` | `src/renderer/components/artifacts/renderers/ModelRenderer.tsx` | Artifacts | Three.js WebGL | 3D Canvas, Controls Overlay | **A** | 3D 网格模型轨道交互 |
| 33 | `DocumentRenderer` | `src/renderer/components/artifacts/renderers/DocumentRenderer.tsx`| Artifacts | 多页文档视口 | Pagination, Zoom, Sheet | **A** | PDF/Office 内嵌轻量解析 |
| 34 | `FileDirectoryView` | `src/renderer/components/artifacts/FileDirectoryView.tsx` | Artifacts | 240px 浮层 | Row Hover, Row Selected | **A** | 多工件文件树切换 |
| 35 | `LocalInferenceView` | `src/renderer/components/localInference/LocalInferenceView.tsx` | LocalInfer | 48px PageHeader | Models Tab, Market Tab | **B+** | 待重构为统一 Model Hub |
| 36 | `ModelsPanel` | `src/renderer/components/localInference/panels/ModelsPanel.tsx` | LocalInfer | 32px 控件, 网格/列表 | Stopped, Loading, Running | **B** | 违规呼吸动画待移除，改行式列表 |
| 37 | `MarketplacePanel` | `src/renderer/components/localInference/panels/MarketplacePanel.tsx` | LocalInfer | 硬件卡片 + 搜索 | Hardware, Card, Search-Bug | **B+** | 搜索错误状态吞没待修复 (25:1335) |
| 38 | `ModelInspectorSidebar` | `src/renderer/components/localInference/components/ModelInspectorSidebar.tsx`| LocalInfer | 300–560px 抽屉 | Overview, Settings, Logs | **A-** | 参数标签分行排版待优化 (26:1684) |
| 39 | `MarketplaceDownloadSidebar`| `src/renderer/components/localInference/components/MarketplaceDownloadSidebar.tsx`| LocalInfer | 360px 下载抽屉 | Downloading, Verifying, Cancel | **A** | 实时速率与分块校验 |
| 40 | `SettingsPage` | `src/renderer/components/settings/SettingsPage.tsx` | Settings | 200px 导航 + 单面表单 | Nav-Active, Form-Focus | **A** | 标准两栏单面分区 |
| 41 | `ModelSettingsPanel` | `src/renderer/components/settings/model/ModelSettingsPanel.tsx` | Settings | 三段式切换 | Providers, Routing, Advanced | **B** | ProviderEditDialog 14px 按钮待重构 |
| 42 | `GeneralSettingsPanel` | `src/renderer/components/settings/general/GeneralSettingsPanel.tsx` | Settings | 36×20px 开关行 | Switch Toggle, Progress | **A** | 系统级参数配置 |
| 43 | `AppearanceSettingsPanel`| `src/renderer/components/settings/appearance/AppearanceSettingsPanel.tsx`| Settings | 单选卡片网格 | Theme Select, Motion Switch | **A** | 明暗模式原位热更新 |
| 44 | `ManagedMemorySettings` | `src/renderer/components/settings/memory/ManagedMemorySettings.tsx`| Settings | 列表 + 检索行 | Filter, Row Delete | **A** | 智能体记忆条目管理 |
| 45 | `IMSettings` | `src/renderer/components/im/IMSettings.tsx` | Settings | 渠道多实例卡片 | Toggle, Test Connection | **A-** | 多渠道即时通讯接入 |
| 46 | `EditProjectDialog` | `src/renderer/components/agentSidebar/EditProjectDialog.tsx` | Modals | 512px 宽, 16px 间距 | Form Open, Pick, Save | **A+** | 全仓弹窗与表单密度标杆 |
| 47 | `DestructiveConfirmDialog`| `src/shared/components/ui/destructive-confirm-dialog.tsx`| Modals | 384px 宽, 红色主键 | Open, Confirming, Danger | **A+** | 统一不可逆删除确认 |
| 48 | `CoworkPermissionModal` | `src/renderer/components/cowork/CoworkPermissionModal.tsx` | Modals | 512px 宽, 代码块 | Danger High, Approve, Deny | **A** | 敏感指令拦截审批 |
| 49 | `ScheduledTasksView` | `src/renderer/components/scheduledTasks/ScheduledTasksView.tsx` | Specialized | 32px 列表操作行 | Task List, Cron Builder, Run | **A** | 计划任务与自动化 Cron |
| 50 | `ActivityView` | `src/renderer/components/activity/ActivityView.tsx` | Specialized | 时间线流 | Source Filter, Status Filter | **A** | 后台任务执行流水审计 |
| 51 | `SkillsManager` | `src/renderer/components/skills/SkillsManager.tsx` | Specialized | 网格卡片 + 抽屉 | Installed, Market, Audit | **A** | 技能安装与静态安全审查 |
| 52 | `McpManager` | `src/renderer/components/mcp/McpManager.tsx` | Specialized | 连接向导弹窗 | Installed, Market, Connect | **A** | 模型上下文协议连接器 |
