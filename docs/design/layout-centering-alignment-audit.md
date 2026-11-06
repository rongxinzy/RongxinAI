# 知远智能体 (ZhiYuan Agent) · 全局布局居中与几何对齐规范审计报告
# Layout Centering & Alignment Comprehensive Repository Audit Report

> **版本**：v4.0.0 (Quiet Studio)  
> **审计日期**：2026-11-05  
> **审计范围**：`src/renderer/`（全量前端组件视图）与 Figma 设计项目 `l1IdC96sLjXx5CfPwcG4pQ`（[知远智能体 — 产品现状与设计重构](https://www.figma.com/design/l1IdC96sLjXx5CfPwcG4pQ/知远智能体-—-产品现状与设计重构?node-id=0-1&p=f&t=BUtatH2p9uYgPDiH-0)）  
> **审计基准**：
> - `DESIGN.md` (v4.0 Quiet Studio)
> - `AGENTS.md` (前端设计规则 P0 门禁、布局归组件、外观归 recipe、Button 使用纪律)
> - `docs/design/reference/index.html` (Quiet Studio 参考实现标杆)
> - 2026-10-13 舒展大气弹窗密度基准 (`EditProjectDialog.tsx`)

---

## 目录 (Table of Contents)

1. [执行摘要 (Executive Summary)](#1-执行摘要-executive-summary)
   - 1.1 审计背景与目标
   - 1.2 审计方法与工具链
   - 1.3 全局缺陷分类统计与严重度分布
2. [全量 48 项缺陷清单与对齐矩阵 (Complete 48-Defect Inventory Matrix)](#2-全量-48-项缺陷清单与对齐矩阵-complete-48-defect-inventory-matrix)
3. [分区域深度技术诊断与代码级方案 (In-Depth Technical Breakdown by Area)](#3-分区域深度技术诊断与代码级方案-in-depth-technical-breakdown-by-area)
   - 3.1 Cowork 核心与 Shell 侧栏架构 (Cowork & Shell Architecture)
     - 3.1.1 C1: 全局会话流与悬浮输入框 16px 不对称右偏 (P0)
     - 3.1.2 C2: QuickActionBar 容器查询 `@4xl` 不可达缺陷 (P1)
     - 3.1.3 C3: 会话骨架屏加载与详情视图宽度突跳 128px (P1)
     - 3.1.4 S1: 侧栏主导航区文字起始线三档锯齿错位 (40px vs 34px vs 36px) (P0)
     - 3.1.5 S2 & S3: 侧栏项目树嵌套任务行硬编码 `ml-[15px]` 与负边距创可贴补丁 (P0 / P1)
     - 3.1.6 S4 & S5: 顶栏分割线 hairline 退化与标题栏毛玻璃残留 (P1)
     - 3.1.7 A1: 左右分栏模式下双顶栏高度错位 8px (P1)
     - 3.1.8 C4, C6, C7, A2, A3: 芯片几何尺寸、顶栏外间距、气泡阅读栏宽度与非标文件视图 (P2)
   - 3.2 设置中心与本地推理 (Settings & Local Inference)
     - 3.2.1 SET1: 设置页脚操作栏限宽 `max-w-3xl` 导致关闭按钮中途悬空 (P1)
     - 3.2.2 SET2: 外观设置面板内层违规冗余 `max-w-3xl` 限制 (P2)
     - 3.2.3 SET3: 快捷键面板 FieldContent 触发顶部对齐覆盖 `items-center` (P1)
     - 3.2.4 SET4: 邮箱高级设置 4px 缩进不对齐与违规卡片化 (P1)
     - 3.2.5 SET5: 即时通讯 (IM) 设置左右边距 32px vs 8px (4:1) 严重不对称 (P2)
     - 3.2.6 SET6: 记忆编辑弹窗继承 `sm:max-w-sm` (384px) 违规窄窗 (P1)
     - 3.2.7 SET7: 模型服务商编辑弹窗禁用字号 `text-[10px]` 与整窗滚动缺陷 (P1)
     - 3.2.8 SET8, LI1, LI3: 空状态居中割裂、标题/描述对齐分歧与 EmptyMedia 槽位混乱 (P1/P2)
     - 3.2.9 SET9 & LI2: 右侧控件宽度锯齿跳动与原生 HTML input 高度不合规 (P2)
   - 3.3 全局模态框与弹窗系统 (Modals & Dialogs Design Standards)
     - 3.3.1 DLG1: DestructiveConfirmDialog 宽度违规 (384px) 与警告文字 `truncate` 粗暴截断安全隐患 (P0)
     - 3.3.2 DLG2: SessionExportDialog 严重超窄 (320px) 违规 (P1)
     - 3.3.3 DLG3: 浮动页脚 8px 悬空凹坑缺陷 (The 8px Footer Gutter Flaw) (P0)
     - 3.3.4 DLG7: Tailwind `sm:` 媒体查询特异性覆盖陷阱 (P0)
     - 3.3.5 DLG4: 手写全屏遮罩与三段式边距锯齿 (px-5, px-8, px-6) (P1)
     - 3.3.6 DLG5: 屏幕水平居中叠加 `mx-4` 导致弹窗向右偏离中轴 16px (P1)
     - 3.3.7 DLG6 & DLG8: McpOfficialConnectDialog 416px 违规与恢复/冲突弹窗回退 (P1)
     - 3.3.8 SP1 & SP2: McpCustomTab 工具栏破坏双列网格 (P0) 与 ExpertView Tab 边距横向跳变 (P1)
   - 3.4 Figma 设计系统现代化与 Auto Layout 重构 (Figma Modernization)
     - 3.4.1 FIG1: 页面级画板 100% 绝对定位假布局现状与 Auto Layout 架构重构
     - 3.4.2 FIG2, FIG3, FIG4: 1px 水平偏心根因推导与对称对齐修正
     - 3.4.3 FIG5: 输入岛内部操作工具栏 Y 轴垂直基线 7px 落差修正
     - 3.4.4 FIG6: 任务会话阅读流 896px (`max-w-4xl`) 规范化与消除 12px 非对称边距
     - 3.4.5 FIG7 & FIG8: 基础组件母版固定宽度僵死缺陷重构 (Fill Container & Hug Contents)
     - 3.4.6 FIG9: 设置中心 5px~25px 边缘锯齿与伪造滚动负坐标重构
     - 3.4.7 FIG10: 基础弹窗母版体系补齐 (448px Base) 与业务弹窗 (672px→512px) 治理
     - 3.4.8 FIG11: 本地推理模型卡片网格 Auto Layout Wrap/Grid 重构
4. [全生命周期验收与追溯检查清单 (Requirements Traceability & Verification Checklist)](#4-全生命周期验收与追溯检查清单-requirements-traceability--verification-checklist)
   - 4.1 Requirement R1: 系统化布局居中与对齐审计全覆盖追溯
   - 4.2 Requirement R2: 代码修复规范与回归验证指令集
   - 4.3 Requirement R3: Figma 设计系统同步标准与验收步骤

---

## 1. 执行摘要 (Executive Summary)

### 1.1 审计背景与目标

知远智能体 (ZhiYuan Agent) 定位于本地优先的高性能 AI Agent 桌面系统，基于 Electron 44、React 18 与 Tailwind CSS v4 构建。随着产品从早期原型向 **DESIGN.md v4.0 (Quiet Studio)** 全面演进，视觉基准已确立为克制、内容优先、统一 32px 控件规格、8px 外框与 12px 抬升面板的桌面级专业质感（以 Codex 与 Linear 为工业标杆）。

然而，历史代码迭代与跨模块协同中产生了显著的**布局退化与几何偏差**。为了贯彻落实用户批准的《全界面布局对齐与居中审计及 Figma 同步》任务，本次专项审计覆盖了 `src/renderer/` 下所有页面组件以及关联的官方 Figma 设计项目（`fileKey: l1IdC96sLjXx5CfPwcG4pQ`），旨在：
1. **全面查清**前端视图中所有「应居中而未居中」（缺 `mx-auto`、单侧 padding 导致质心偏离、容器查询断档）与「应齐平而参差不齐」（文字起始线锯齿、双顶栏错边、弹窗宽度破规）的缺陷；
2. **深入溯源**代码中由于 Tailwind CSS 特异性覆盖、Flex/Grid 槽位样式冲突、手写负边距补丁引发的深层根因；
3. **彻底审计** Figma 设计稿中由于缺乏 Auto Layout、绝对坐标拖放产生的 1px~12px 偏心与弹窗母版缺失；
4. **输出权威交付文档**，为后续修复与回归测试提供端到端的技术契约。

### 1.2 审计方法与工具链

本次审计采用了四重交叉验证方法学：
1. **静态代码几何分析 (Static Code Geometry Scan)**: 对 `src/renderer/` 核心组件进行 AST 与 CSS 模式扫描，重点检索非对称 padding（如 `pl-4` 无 `pr-4`）、硬编码负边距（`ml-[-6px]`）、任意值（`ml-[15px]`）、容器查询断点匹配（`@4xl` vs `max-w-3xl`）、以及裸 `div onClick`。
2. **浏览器运行时无头走查 (Headless Browser & Preview Inspection)**: 利用 `bun run web:preview` 启动浏览器预览模式，在标准 1280×800、1440×900 及 1024×768 视口下走查浅色/深色主题，使用 DOM 测量工具检查实际计算样式（Computed Styles）与渲染盒模型（BoundingClientRect）。
3. **设计系统契约审计 (Design System Contract Audit)**: 对照 `DESIGN.md` (v4.0 Quiet Studio) 与 `src/renderer/theme/` token/recipe 契约，核查字号（严禁 `<12px`）、弹窗宽度（门禁最小 448px）、以及表面材质（严禁毛玻璃 `backdrop-blur`）。
4. **Figma MCP 几何测量与元数据提取 (Figma MCP Geometric Trace)**: 通过 Figma MCP 工具直接拉取目标云端画板节点树，逐层检查各组件的 `layoutMode`、`primaryAxisSizingMode`、`layoutPositioning`、绝对坐标值与内边距分布。

### 1.3 全局缺陷分类统计与严重度分布

本次审计在代码库与 Figma 设计稿中共识别出 **48 项具体布局与几何缺陷**，分类统计如下：

#### 严重度级别分布 (Severity Distribution)
- **P0 严重级 / 阻断性缺陷 (Critical / Blocking) — 10 项**: 破坏核心功能可用性、导致重要安全警告文字截断、网格布局结构性错乱、文字起始线显著锯齿（落差 ≥6px）、整屏消息流 16px 不对称右偏、或设计系统核心母版全面缺失。
- **P1 次级 / 结构性缺陷 (Major / Structural) — 25 项**: 弹窗宽度低于 448px 规范、双栏分割线错位 8px、骨架屏状态切换突跳 128px、容器查询在大屏下失效、破坏无障碍与点击热区、或 1px~12px 几何偏心。
- **P2 一般规范性缺陷 (Minor / Spec Conformance) — 13 项**: 胶囊圆角与高度非标、外边距微量不对称、非标准空状态排版、禁用小字号 (`text-[10px]`)、或卡片同排未自适应等高。

#### 功能区域分布 (Module Breakdown)
```
┌─────────────────────────────────────────────────────────────┬────────┐
│ 功能区域 (Audited Area)                                     │ 缺陷数 │
├─────────────────────────────────────────────────────────────┼────────┤
│ Cowork 会话与核心输入岛 (C1 - C7)                            │  7 项  │
│ Shell 侧边栏与窗口底座 (S1 - S5)                             │  5 项  │
│ 产物预览与多模态分栏 (A1 - A3)                               │  3 项  │
│ 设置中心行式面板 (SET1 - SET9)                               │  9 项  │
│ 本地推理与模型面板 (LI1 - LI3)                               │  3 项  │
│ 全局弹窗与模态对话框 (DLG1 - DLG8)                           │  8 项  │
│ 专用功能视图 (SP1 - SP2)                                     │  2 项  │
│ Figma 设计系统与几何画板 (FIG1 - FIG11)                       │ 11 项  │
├─────────────────────────────────────────────────────────────┼────────┤
│ 合计 (Total)                                                │ 48 项  │
└─────────────────────────────────────────────────────────────┴────────┘
```

#### 缺陷模式分类 (Defect Category Breakdown)
1. **Uncentered Container / Asymmetric Margin (容器未居中 / 单侧边距偏移)**: 8 项 (C1, C2, C7, DLG5, FIG2, FIG3, FIG4, FIG6)
2. **Padding Asymmetry / Misaligned Gutter (内边距不对称 / 槽位错位)**: 6 项 (SET4, SET5, DLG4, SP2, FIG9, FIG5)
3. **Staggered Text Start Line (文字起始线犬牙交错)**: 3 项 (S1, S2, S3)
4. **Dialog Width Under 448px Minimum Standard (弹窗宽度低于 448px 门禁)**: 7 项 (C5, SET6, DLG1, DLG2, DLG6, DLG8, FIG10)
5. **The 8px Floating Footer Gutter Flaw (8px 悬空凹槽缺陷)**: 3 项 (DLG3 涵盖 3 个业务弹窗)
6. **Broken Container Query / Specificity Trap (容器查询断档 / 断点覆盖陷阱)**: 3 项 (C2, DLG7, SET3)
7. **Header Height Mismatch / Divider Fracture (顶栏高度错位 / 分隔线断裂)**: 2 项 (A1, S4)
8. **Fixed Absolute Coordinates / Rigid Sizing (固定坐标 / 僵死固定尺寸)**: 16 项 (S5, A2, A3, SET1, SET2, SET7, SET8, SET9, LI1, LI2, LI3, SP1, FIG1, FIG7, FIG8, FIG11)

---

## 2. 全量 48 项缺陷清单与对齐矩阵 (Complete 48-Defect Inventory Matrix)

下表汇总了本次审计确认的全部 48 项缺陷，包含确切的代码文件位置/Figma 节点、当前几何参数、根因与基于 DESIGN.md v4.0 的修复方案：

| 缺陷 ID | 模块 / 区域 | 目标文件路径 / Figma Node ID | 行号 / 几何参数 | 缺陷类别 | 严重度 | 核心根因简析 | 规范整改方案 (Remedy) | 修复状态 |
|---|---|---|---|---|---|---|---|---|
| **C1** | Cowork | `src/renderer/components/cowork/components/UserBubble.tsx`, `TurnBlock.tsx`, `CoworkSessionDetail.tsx`, `sessionDetail/SessionComposerOverlay.tsx` | UserBubble:174<br>TurnBlock:332<br>SessionDetail:417,430<br>ComposerOverlay:20-21 | Padding Asymmetry | **P0** | 各消息气泡与悬浮输入框在已有 `p-4`/`px-3` 外层上额外叠写 `pl-4`，导致左边距 32px vs 右边距 16px，产生 16px 全局视觉向右偏移 | 移除各子组件内部冗余 `pl-4`；内层宽度从 `max-w-6xl` 规范化为 `max-w-4xl`，恢复完美居中 | 待实施 |
| **C2** | Cowork | `src/renderer/components/quick-actions/QuickActionBar.tsx` | Lines 40–41 | Broken Container Query | **P1** | 外层被定死在 `max-w-3xl` (768px)，内部却使用 `@4xl` (896px) 容器查询，导致大屏 (≥1280px) 永远无法触发单行居中，退化为 3 列网格 | 将查询条件调整为断点 `xl:flex xl:flex-wrap xl:items-center xl:justify-center` 或适配 768px 的 `@2xl` | 待实施 |
| **C3** | Cowork | `src/renderer/components/cowork/CoworkSessionLoadingState.tsx` | Lines 31, 71 | Uncentered Container | **P1** | 骨架屏采用 `max-w-5xl px-8` (1024px)，而详情页为 `max-w-4xl px-4` (896px)，加载完成瞬间发生 128px 容器突变横向抖动 | 骨架屏统一重构为与主详情一致的 `max-w-4xl px-4`，保证几何平滑过渡 | 待实施 |
| **C4** | Cowork | `src/renderer/components/cowork/promptInput/GoalModeChip.tsx`, `ActiveExpertBadge.tsx` | GoalMode:14<br>ExpertBadge:37 | Rigid Sizing | **P2** | 胶囊使用 24px 高度 (`h-6`) 与 `rounded-full`，与 Quiet Studio 统一 32px 高、8px 圆角 (`radius-lg`) 规范冲突 | 统一采用 `h-8`、`rounded-lg` 规格，与其他输入操作项高度与圆角齐平 | 待实施 |
| **C5** | Cowork | `src/renderer/components/cowork/sessionDetail/SessionExportDialog.tsx` | Line 26 / 50 | Dialog Width Under 448px | **P1** | 采用 `sm:max-w-xs` (320px)，按钮被严重挤压换行，违背表单弹窗最小宽度 448px 门禁 | 升级为 `sm:max-w-md` (448px)，保持舒展大气标准 | 待实施 |
| **C6** | Cowork | `src/renderer/components/cowork/SecurityStatusIndicator.tsx` | Line 22 | Padding Asymmetry | **P2** | 包含多余内联 `mr-2`，与顶栏 flex `gap` 叠加造成右侧留白不对称 | 移除 `mr-2`，由顶栏父容器 flex 统一调度间距 | 待实施 |
| **C7** | Cowork | `src/renderer/components/cowork/components/UserBubble.tsx`, `TurnBlock.tsx` | UserBubble:174<br>TurnBlock:332 | Uncentered Container | **P2** | 消息流气泡内部声明 `max-w-6xl`，与外层容器 896px (`max-w-4xl`) 阅读栏基准宽度不相符 | 将气泡最大宽度统一设为 `max-w-4xl`，保持上下对齐边界一致 | 待实施 |
| **S1** | Shell | `src/renderer/components/shell/SidebarNavigationView.tsx` | Lines 45, 140, 160 | Staggered Text Start Line | **P0** | 新建任务按钮使用 `size="lg"` 与内联 `gap-2`，搜索按钮使用 `gap-2` 覆盖，导致文字起始线呈 40px vs 34px vs 36px 显著锯齿 | 移除内联 `gap-2` 覆盖，统一按钮规范样式，使文字起始线严格对齐在 36px | 待实施 |
| **S2** | Shell | `src/renderer/components/agentSidebar/AgentTaskRow.tsx` | Line 109 | Staggered Text Start Line | **P0** | 嵌套任务行硬编码 `ml-[15px]`，与父级文件夹文字起始线规范 36px 相差 11px，无法上下对齐 | 移除 `ml-[15px]`，改为 `pl-[36px] w-full`，文字与父级文件夹完全齐平 | 待实施 |
| **S3** | Shell | `src/renderer/components/agentSidebar/WorkspaceTreeNode.tsx` | Lines 227, 233, 240 | Padding Asymmetry | **P1** | 使用 `ml-[-6px]` 和 `w-[calc(100%+12px)] pl-[38px]` 负边距补丁互相抵消，造成 DOM 盒模型污染 | 清理 `ml-[-6px]` 与 `calc` 补丁，统一使用规范的 `pl-[36px]` | 待实施 |
| **S4** | Shell | `src/renderer/components/shell/PageHeaderLayout.tsx` | Lines 27, 39 | Header Height Mismatch | **P1** | 顶栏分割线退化为 `border-border-subtle`，违背 DESIGN.md 规定必须使用 `--border` 的红线 | 将 `border-border-subtle` 替换为标准语义 token `border-border` | 待实施 |
| **S5** | Shell | `src/renderer/components/window/WindowTitleBar.tsx` | Line 87 | Fixed Absolute Coordinates | **P1** | 残留废止的毛玻璃样式 `backdrop-blur-sm` 与 `bg-surface/35` 半透明表面，违背 Quiet Studio 规定 | 移除 `backdrop-blur-sm`，改用实色不透明表面 `bg-surface` | 待实施 |
| **A1** | Artifacts | `src/renderer/components/artifacts/ArtifactPanel.tsx` | Lines 427, 618 | Header Height Mismatch | **P1** | 左右分栏模式下，产物面板头部写死 40px (`h-10`)，与主会话 `PageHeader` (48px) 错开 8px 台阶 | 将 `ArtifactPanel.tsx` 顶栏高度统一提升为 48px (`h-12`)，两栏下边框齐平 | 待实施 |
| **A2** | Artifacts | `src/renderer/components/artifacts/FileDirectoryView.tsx` | Lines 11-20, 126-135 | Rigid Sizing | **P2** | 使用硬编码 emoji 图标，行点击使用裸 `div role="button"`，内边距偏离 32px 行规范 | 重构为标准 `Button variant="ghost"`，引入标准 Lucide 图标替代 Emoji | 待实施 |
| **A3** | Artifacts | `src/renderer/components/artifacts/renderers/document/FileInfoFallback.tsx` | Line 21 | Rigid Sizing | **P2** | 空状态使用巨大 `text-5xl` emoji 图标与非标居中，脱离 Quiet Studio 专业克制基调 | 迁移为标准 shadcn/ui Empty 结构，使用 48px/32px Lucide 图标与标准排版 | 待实施 |
| **SET1** | Settings | `src/renderer/components/settings/SettingsPage.tsx` | Lines 445–485 | Uncentered Container | **P1** | 底部操作栏内部容器被限死在 `max-w-3xl`，视口加宽时“关闭”按钮停在 768px 悬空 | 移除内部 `max-w-3xl`，改为全宽 `w-full` 弹性右对齐 | 待实施 |
| **SET2** | Settings | `src/renderer/components/settings/appearance/AppearanceSettingsPanel.tsx` | Line 79 | Uncentered Container | **P2** | 网格内部冗余套用 `max-w-3xl`，违反 DESIGN.md 第 548 行规则，导致宽屏右侧出现大面积空白 | 移除网格上的 `max-w-3xl`，保持 `w-full` 撑满内容列 | 待实施 |
| **SET3** | Settings | `src/renderer/components/settings/shortcuts/ShortcutsSettingsPanel.tsx` | Lines 88–112 | Broken Container Query | **P1** | `<FieldContent>` 子选择器触发了 field 的 `items-start` 覆盖，使快捷键胶囊垂直偏上 | 移除多余包裹或在 Field 上强制添加 `!items-center`，保证基准线垂直居中 | 待实施 |
| **SET4** | Settings | `src/renderer/components/settings/email/EmailAdvancedFields.tsx` | Lines 106, 122–140 | Padding Asymmetry | **P1** | 展开区域设置 `px-1` 产生 4px 左缩进错位；开关使用独立小卡片包装违背行式列表规范 | 移除 `px-1` 恢复左对齐；移除卡片外框改用标准行式 `Field` | 待实施 |
| **SET5** | Settings | `src/renderer/components/settings/im/IMSettings.tsx` | Lines 210–230 | Padding Asymmetry | **P2** | 内容区 `pl-4` 叠加 `gap-4` 形成 32px 留白，而右侧仅 `pr-2` (8px)，左右留白比达 4:1 | 改为对称的水平内边距 `px-4`，保证两端视觉留白均等 | 待实施 |
| **SET6** | Settings | `src/renderer/components/settings/memory/ManagedMemorySettings.tsx` (`MemoryEditorDialog`) | Lines 66–98 | Dialog Width Under 448px | **P1** | 弹窗未指定宽度类，回退至 `dialog.tsx` 基础的 `sm:max-w-sm` (384px)，4 个字段严重挤压 | 显式声明 `sm:max-w-lg` (512px)，满足多字段弹窗标准 | 待实施 |
| **SET7** | Settings | `src/renderer/components/settings/model/ProviderEditDialog.tsx` | Lines 525, 650, 658 | Fixed Absolute Coordinates | **P1** | 出现禁用小字号 `text-[10px]`；整个 `DialogContent` 滚动导致 Header/Footer 移出可视区 | 字号升为 `text-xs` (12px)；滚动区域下放至主体，Header/Footer 保持固定 | 待实施 |
| **SET8** | Settings | `src/renderer/components/settings/model/ModelRoutingUsageSections.tsx`, `ModelCatalogBrowser.tsx` | Usage:55,127,251<br>Catalog:108 | Uncentered Container | **P2** | 空状态使用普通左对齐 `<p>` 标签，在整块统计卡片中偏靠左侧脱离中轴 | 统一采用 `@shared/components/ui/empty` 或 `flex flex-col items-center justify-center` | 待实施 |
| **SET9** | Settings | `src/renderer/components/settings/model/MagpiePreferenceControls.tsx` | Lines 120–165 | Padding Asymmetry | **P2** | 右侧控件宽度随意混合使用 `lg:w-64`, `lg:w-40`, `lg:w-48`, `lg:w-80`，右边缘呈犬牙错乱 | 桌面端统一使用 `sm:w-64` (256px) 统一控件宽度，保持右边缘齐平 | 待实施 |
| **LI1** | Local Inference | `src/renderer/components/localInference/components/ModelStartedDialog.tsx` | Lines 52–65 | Uncentered Container | **P1** | 标题添加了 `text-center`，但下方长段描述文字为默认左对齐，造成上下对齐割裂 | 描述文本同样添加 `text-center`，`DialogHeader` 设置整体居中对齐 | 待实施 |
| **LI2** | Local Inference | `src/renderer/components/localInference/components/ModelContextSettingsModal.tsx` | Lines 78–85 | Rigid Sizing | **P2** | 采用原生 `<input>` 且高度仅 28px (`h-7`)；MoE 行与上下文行 gap 不一致 (gap-0 vs gap-2) | 采用标准 `<Input className="h-8 w-24 text-sm" />`，统一 `gap-2` | 待实施 |
| **LI3** | Local Inference | `src/renderer/components/localInference/panels/ModelsPanel.tsx` | Lines 140–155 | Uncentered Container | **P2** | `EmptyMedia` 被放置在 `EmptyHeader` 外部，破坏了 Empty 组件的标准垂直流间距 | 将 `EmptyMedia` 移至 `EmptyHeader` 内部，恢复规范插槽排版 | 待实施 |
| **DLG1** | Dialogs | `src/shared/components/ui/destructive-confirm-dialog.tsx` | Lines 54, 60 | Dialog Width Under 448px | **P0** | 宽度仅 384px (`max-w-sm`)；警告描述带有 `truncate` 截断，导致关键删除后果文字被截断为省略号 | 宽度升级为 `sm:max-w-md` (448px)；移除 `truncate`，改为自适应换行完整展示 | 待实施 |
| **DLG2** | Dialogs | `src/renderer/components/cowork/sessionDetail/SessionExportDialog.tsx` | Line 50 | Dialog Width Under 448px | **P1** | 声明 `sm:max-w-xs` (320px)，属于严重超窄违规弹窗，导致多项导出选项挤压折行 | 升级为 `sm:max-w-md` (448px) | 待实施 |
| **DLG3** | Dialogs | `src/renderer/components/skills/CreateSkillDialog.tsx`, `ImportMcpDialog.tsx`, `CreateExpertDialog.tsx` | Skill:92,160<br>Mcp:75,140<br>Expert:180,520 | 8px Footer Gutter Flaw | **P0** | `DialogContent` 设为 `p-6` (24px)，而 `DialogFooter` 默认贴边补偿为 `-mx-4 -mb-4` (-16px)，差值产生 8px 悬空凹缝 | 指定 `surface={DialogFooterSurface.Seamless}` 并统一设定 `px-6 pb-6 pt-4` 消除凹缝 | 待实施 |
| **DLG4** | Dialogs | `src/renderer/components/skills/SkillDocumentDialog.tsx`, `MarketplaceSkillDocumentDialog.tsx` | Skill:80–140<br>Mkt:80–140 | Padding Asymmetry | **P1** | 手写全屏遮罩；且 Header (`px-5`), Body (`px-8`), Footer (`px-6`) 水平内边距各不相同，呈现锯齿边缘 | 重构为标准 `<Dialog>`，各段水平内边距严格统一为 `px-6` (24px) | 待实施 |
| **DLG5** | Dialogs | `src/renderer/components/skills/manager/RemoteImportModal.tsx` | Lines 48, 52 | Uncentered Container | **P1** | 在 `left-1/2 -translate-x-1/2` 屏幕居中之后又添加了 `mx-4`，导致弹窗向右偏离屏幕中心点 16px | 移除外层 `mx-4` 与多余 `createPortal`，恢复纯净绝对几何居中 | 待实施 |
| **DLG6** | Dialogs | `src/renderer/components/mcp/McpOfficialConnectDialog.tsx`, `McpTokenConnectDialog.tsx` | Official:60<br>Token:80–120 | Dialog Width Under 448px | **P1** | 宽度仅 416px (`max-w-[26rem]`)；密码显隐使用绝对定位手动计算偏移而非标准 InputGroup | 升级为 `sm:max-w-md` (448px)；接入标准 `<InputGroup>` 规范组件 | 待实施 |
| **DLG7** | Dialogs | `src/renderer/components/coding/CodingAuthTerminalDialog.tsx`, `codingWorkbenchDialogs.tsx` | Terminal:40<br>Workbench:56 | Broken Container Query | **P0** | 传入裸 `max-w-3xl`，在桌面端 (≥640px) 被基础样式 `sm:max-w-sm` 依据特异性规则强制覆盖，坍塌至 384px | 必须添加响应式前缀，修正为 `sm:max-w-3xl` | 待实施 |
| **DLG8** | Dialogs | `src/renderer/components/coding/codingWorkbenchDialogs.tsx`, `scheduledTasks/FailureDetailModal.tsx` | Coding:24,86<br>Failure:39 | Dialog Width Under 448px | **P1** | 冲突/恢复弹窗及崩溃日志弹窗未写宽度类，回退至 384px 窄窗，查看代码差异与日志极其局促 | 冲突恢复弹窗加 `sm:max-w-lg` (512px)；崩溃日志弹窗加 `sm:max-w-xl` (576px) | 待实施 |
| **SP1** | Specialized | `src/renderer/components/mcp/mcpManager/McpCustomTab.tsx` | Lines 46–76 | Padding Asymmetry | **P0** | 操作按钮栏塞入 `grid-cols-2` 却未加 `col-span-full`，被当成卡片占满第 1 行第 1 列，破坏卡片网格对称 | 按钮工具栏移出 grid 或显式添加 `col-span-full mb-1` | 待实施 |
| **SP2** | Specialized | `src/renderer/components/expert/ExpertView.tsx` | Lines 89, 98, 117 | Padding Asymmetry | **P1** | Experts Tab 为 `px-4 sm:px-6`，Skills Tab 为 `px-6`，Mcp Tab 为 `px-4`，切换 Tab 时内容区发生 8px 左右抖动 | 统一三个 Tab 页面外层水平内边距为 `px-4 sm:px-6 py-4` | 待实施 |
| **FIG1** | Figma | 画板 `6:131`, `7:105`, `12:275`, `9:107`, `24:301` | 根画板 1280×800 | Fixed Absolute Coordinates | **P0** | 核心画板 100% 采用绝对坐标静态拖放，完全未使用现代 Auto Layout，无法适配响应式 | 根画板与舞台容器全面开启 Auto Layout (Flexbox) 布局架构 | 待实施 |
| **FIG2** | Figma | 首页核心输入岛 (Composer), Node `6:257` | `w=768, left=121` (舞台 1012px) | Uncentered Container | **P1** | 理想中心左边距应为 `(1012-768)/2 = 122px`，实际为 121px，存在 1px 偏左误差 | 放入 Auto Layout 水平居中流 (`counterAxisAlignItems: CENTER`)，消除 1px 偏心 | 待实施 |
| **FIG3** | Figma | 时段问候语与副标题, Node `6:255`, `6:256` | 问候: left=361<br>副标: left=316 | Uncentered Container | **P1** | 舞台宽 1012px，问候语宽 288px (应为 362px)，副标题宽 378px (应为 317px)，均偏左 1px | 文本对齐设为 CENTER，外层启用 Auto Layout 水平居中对齐 | 待实施 |
| **FIG4** | Figma | 快捷动作胶囊组, Node `6:265` | 总宽 690px, left=160 | Uncentered Container | **P1** | 理想左边距应为 `(1012-690)/2 = 161px`，实际为 160px，偏左 1px；胶囊缺乏 Hug contents | 设为 Auto Layout 水平居中对齐，子胶囊开启 Hug contents 自适应宽度 | 待实施 |
| **FIG5** | Figma | 输入岛内部操作工具栏, Node `6:257` | top: 98px, 100px, 93px | Padding Asymmetry | **P1** | 附件图标、模型选择器与发送按钮垂直 top 坐标不一，垂直基线落差达 7px，视觉晃动 | 底部工具栏开启 Auto Layout `HORIZONTAL`，`alignItems: CENTER` 统一 32px 垂直居中 | 待实施 |
| **FIG6** | Figma | 任务会话阅读流, Node `12:320`, `13:101`, `12:334` | 872px & 860px, left=70 (余82px) | Uncentered Container | **P0** | 未执行 DESIGN.md 896px (`max-w-4xl`) 规范，宽度随意设为 872/860px，且左右偏差达 12px | 建立标准 896px 会话阅读流容器，水平严格居中，内部卡片设为 100% Fill container | 待实施 |
| **FIG7** | Figma | 侧栏导航行母版, Node `4:34` | 母版 `w=224, h=32` | Rigid Sizing | **P1** | 侧栏可用内容区为 244px，母版写死 224px 导致无法自适应撑满，产生 18px 悬空 | 设为 `layoutSizingHorizontal: FILL`，内边距规范为 `px=10, gap=10` | 待实施 |
| **FIG8** | Figma | 32px 次要按钮母版, Node `4:60` | 母版 `w=112, h=32` | Rigid Sizing | **P1** | 写死固定宽度 112px，导致短文本留白过多，英文或长文本直接爆框换行 | 设为 `layoutSizingHorizontal: HUG` (Hug contents)，左右 padding 统一为 12px | 待实施 |
| **FIG9** | Figma | 设置中心画板各层级, Node `9:152`, `9:176`, `9:100`, `9:217` | 744px / 720px / 792px, 按钮差 5px | Padding Asymmetry | **P1** | 内容区、设置行母版与底栏宽度各不相同，右侧边缘呈现 5px~25px 显著错位 | 统一采用 Auto Layout 纵向流，设置行与底栏全部设为 `FILL` 撑满内容列 | 待实施 |
| **FIG10** | Figma | 弹窗与对话框画板体系, Node `16:1008` 及全局 | 缺少标准母版；业务弹窗 672px | Dialog Width Under 448px | **P0** | 基础组件库完全缺失 448px 标准弹窗母版；新建任务弹窗非标做成 672px 且多项溢出 | 新建 `Dialog/Form/448` 与 `Dialog/Confirm/448` 规范母版；重构业务弹窗为 512px | 待实施 |
| **FIG11** | Figma | 本地推理模型卡片网格, Node `25:291` | 绝对坐标布局卡片 | Fixed Absolute Coordinates | **P1** | 6 张卡片全部用绝对坐标写死，一旦卡片描述文字折行变高，与下方卡片产生重叠碰撞 | 网格容器开启 Auto Layout `HORIZONTAL (Wrap)` 或等宽 Grid，间距统一为 `gap=16` | 待实施 |

---

## 3. 分区域深度技术诊断与代码级方案 (In-Depth Technical Breakdown by Area)

### 3.1 Cowork 核心与 Shell 侧栏架构 (Cowork & Shell Architecture)

#### 3.1.1 C1: 全局会话流与悬浮输入框 16px 不对称右偏 (P0 严重级)

- **现象与影响**:  
  当用户进入 Cowork 会话详情界面时，整个中央阅读列看似居中，但在高精度屏幕或对照垂直中轴参考线时，所有消息气泡、工具执行卡片及底部悬浮输入框整体向右偏离约 16px。
- **直接代码观察**:
  1. `src/renderer/components/cowork/components/UserBubble.tsx` (Line 174):
     ```tsx
     <div className="mx-auto flex w-full max-w-6xl min-w-[320px] flex-col items-end pl-4">
     ```
  2. `src/renderer/components/cowork/components/TurnBlock.tsx` (Line 332):
     ```tsx
     <div className="mx-auto w-full max-w-6xl min-w-[320px] pl-4">
     ```
  3. `src/renderer/components/cowork/CoworkSessionDetail.tsx` (Lines 416–418, 430):
     ```tsx
     <div className="px-3 pt-3">
       <div className="mx-auto w-full max-w-4xl min-w-[320px] pl-4">
         <AskUserQuestionCard ... />
       </div>
     </div>
     ```
  4. `src/renderer/components/cowork/sessionDetail/SessionComposerOverlay.tsx` (Lines 20–21):
     ```tsx
     <div className="session-composer-overlay fixed inset-x-0 bottom-0 z-30 pointer-events-none px-4 pb-4">
       <div className="mx-auto w-full max-w-4xl min-w-[320px] pl-4">
     ```
- **根因推导 (Root Cause)**:
  最外层的会话滚动视口 `ConversationContent` 已经自带了标准的对称水平内边距 `p-4` (16px)。然而，每个独立消息气泡、回合卡片容器、用户交互卡片以及底部的悬浮输入覆盖层，都在自己的内层容器上额外添加了单侧的 `pl-4` (padding-left: 16px)，且**没有任何一个组件添加对称的 `pr-4`**！  
  导致计算公式为：
  - 左侧留白：外层 `16px` + 内部 `16px` = **32px**；
  - 右侧留白：外层 `16px` + 内部 `0px` = **16px**。  
  内容质心被硬生生向右推了 8~16px，破坏了 `mx-auto` 的完美居中，造成严重的视觉不平衡。
- **代码级整改方案**:
  ```diff
  // UserBubble.tsx:174
  - <div className="mx-auto flex w-full max-w-6xl min-w-[320px] flex-col items-end pl-4">
  + <div className="mx-auto flex w-full max-w-4xl min-w-[320px] flex-col items-end">

  // TurnBlock.tsx:332
  - <div className="mx-auto w-full max-w-6xl min-w-[320px] pl-4">
  + <div className="mx-auto w-full max-w-4xl min-w-[320px]">

  // CoworkSessionDetail.tsx:416-418
    <div className="px-3 pt-3">
  -   <div className="mx-auto w-full max-w-4xl min-w-[320px] pl-4">
  +   <div className="mx-auto w-full max-w-4xl min-w-[320px]">

  // SessionComposerOverlay.tsx:20-21
    <div className="session-composer-overlay fixed inset-x-0 bottom-0 z-30 pointer-events-none px-4 pb-4">
  -   <div className="mx-auto w-full max-w-4xl min-w-[320px] pl-4">
  +   <div className="mx-auto w-full max-w-4xl min-w-[320px]">
  ```

---

#### 3.1.2 C2: QuickActionBar 容器查询 `@4xl` 不可达缺陷 (P1 次级)

- **直接代码观察**:
  `src/renderer/components/quick-actions/QuickActionBar.tsx` (Lines 40–41):
  ```tsx
  <div className="@container mx-auto w-full max-w-3xl">
    <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:@4xl:flex xl:@4xl:flex-wrap xl:@4xl:items-center xl:@4xl:justify-center">
  ```
- **根因推导 (Root Cause)**:
  1. 父容器被约束在 `max-w-3xl`（Tailwind 规范值为 `48rem` = **768px**）；
  2. Tailwind 容器查询插件中，`@4xl` 的阈值是 `56rem` = **896px**；
  3. 因为容器物理最大宽度被死死锁在 768px，无论视口被拉伸到多大（即使是 4K 显示器 3840px），该容器的计算宽度也永远无法达到 896px！
  4. 导致 `xl:@4xl:flex ...` 这一复合规则在物理上永远为假（Dead Code），大屏下本应执行的单行居中（DESIGN.md §六.3 规定：“首页快捷动作：≥1280px 保持单行居中”）彻底失效，永远退化为 3 列网格。
- **代码级整改方案**:
  ```diff
  // QuickActionBar.tsx:40-41
    <div className="@container mx-auto w-full max-w-3xl">
  -   <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:@4xl:flex xl:@4xl:flex-wrap xl:@4xl:items-center xl:@4xl:justify-center">
  +   <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:flex xl:flex-wrap xl:items-center xl:justify-center">
  ```

---

#### 3.1.3 C3: 会话骨架屏加载与详情视图宽度突跳 128px (P1 次级)

- **直接代码观察**:
  `src/renderer/components/cowork/CoworkSessionLoadingState.tsx` (Lines 31, 71):
  ```tsx
  export const CoworkConversationLoadingSkeleton = () => (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-8 py-6">
  ...
  <div className="mx-auto w-full max-w-5xl">
    <CoworkPromptInputSkeleton />
  </div>
  ```
- **根因推导 (Root Cause)**:
  骨架屏容器使用了 `max-w-5xl` (1024px) 并配有 `px-8` (32px)；而加载完成后的真实会话详情视图（`CoworkSessionDetail.tsx`）采用标准的 `max-w-4xl` (896px) 配 `px-4` (16px)。  
  当会话数据异步到达、骨架屏切换为真实视图的瞬间，页面中央内容区域的最大宽度瞬间从 1024px 收缩至 896px，造成整个视窗两侧边距发生 **128px 的强烈瞬态跳跃 (Layout Jitter)**，严重违反 DESIGN.md §八.3 状态连续性与加载规范。
- **代码级整改方案**:
  ```diff
  // CoworkSessionLoadingState.tsx:31
  - <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-8 py-6">
  + <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-6">

  // CoworkSessionLoadingState.tsx:71
  - <div className="mx-auto w-full max-w-5xl">
  + <div className="mx-auto w-full max-w-4xl">
  ```

---

#### 3.1.4 S1: 侧栏主导航区文字起始线三档锯齿错位 (P0 严重级)

- **直接代码观察**:
  `src/renderer/components/shell/SidebarNavigationView.tsx`:
  - Lines 141–142（新建会话按钮）:
    ```tsx
    <Button variant="secondary" size="lg" className="w-full justify-start gap-2" ...>
      <SquarePen className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-left">{newConversation.label}</span>
      <span className="theme-shell-kbd shrink-0">{newTaskShortcutLabel}</span>
    </Button>
    ```
  - Lines 158–160（搜索按钮）:
    ```tsx
    <Button variant="navigation" size="navigation" className="w-full justify-start gap-2" ...>
      <Search className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-left">{search.label}</span>
      <span className="theme-shell-kbd shrink-0">{searchShortcutLabel}</span>
    </Button>
    ```
  - Lines 45–59（功能导航项，如编程、自动化）:
    ```tsx
    <Button variant="navigation" size="navigation" ...>
      <div className="flex size-4 shrink-0 items-center justify-center">
        <Icon aria-hidden="true" className="size-4" strokeWidth={1.5} />
      </div>
      <span className="min-w-0 truncate">{entry.label}</span>
    </Button>
    ```
- **几何与 CSS 契约推导**:
  依据 `src/renderer/theme/css/themes.css`：
  - `.theme-button-size-navigation`: `height: 2rem; gap: 0.625rem (10px); padding-inline: 0.625rem (10px);`
  - `.theme-button-size-lg`: `height: 2.25rem; gap: 0.5rem (8px); padding-inline: 1rem (16px);`
  
  三者的文字起点计算：
  1. **新建任务**: `16px (padding) + 16px (icon) + 8px (gap-2 内联覆盖) = 40px`；
  2. **搜索按钮**: `10px (padding) + 16px (icon) + 8px (gap-2 内联覆盖) = 34px`；
  3. **功能导航**: `10px (padding) + 16px (icon) + 10px (契约 gap) = 36px`。
  
  **严重缺陷**: 垂直相邻的三个高频主入口，文字起始线分别是 **40px、34px、36px**！用户视线扫过侧栏时，文字呈现锯齿状左右晃动（差距高达 6px），公然违背 DESIGN.md §二.5 与 §六.1：“同类可点击行统一规格，文字起点对齐同一条线”。
- **代码级整改方案**:
  统一移除内联 `gap-2`，将新建按钮的外观与内边距通过契约规范化，确保所有按钮的水平 padding 为 10px、gap 为 10px，文字起始线严格锁定在 **36px**。
  ```diff
  // SidebarNavigationView.tsx:141
    <Button
      type="button"
      variant="secondary"
  -   size="lg"
  -   className="w-full justify-start gap-2"
  +   size="navigation"
  +   className="w-full justify-start"
      ...
    >

  // SidebarNavigationView.tsx:160
    <Button
      type="button"
      variant="navigation"
      size="navigation"
  -   className="w-full justify-start gap-2"
  +   className="w-full justify-start"
      ...
    >
  ```

---

#### 3.1.5 S2 & S3: 侧栏项目树嵌套任务行硬编码 `ml-[15px]` 与负边距创可贴补丁 (P0 / P1)

- **直接代码观察**:
  1. `src/renderer/components/agentSidebar/AgentTaskRow.tsx` (Line 109):
     ```tsx
     className={`theme-surface-agent-row sidebar-session-row group relative ${
       // 2026/09/22 lixiang  文件夹下任务整体左缩进 15px（与 padding-left 15px 等效需求）
       isNested ? 'ml-[15px] w-[calc(100%-15px)]' : 'ml-0 w-full'
     } flex items-center ...`}
     ```
  2. `src/renderer/components/agentSidebar/WorkspaceTreeNode.tsx` (Lines 227, 233, 240):
     ```tsx
     <Button ... className="... ml-[-6px] flex justify-start">
     <div className="ml-[-6px] flex h-7 w-[calc(100%+12px)] items-center pl-[38px] pr-2.5 ...">
     ```
- **根因推导 (Root Cause)**:
  - 父级文件夹项的文字起始线为：`10px (padding) + 16px (chevron) + 10px (gap) = 36px`。
  - `DESIGN.md` §六.1 line 233 明确要求：`会话行缩进 36px（10 + 16 + 10），文字与文件夹名对齐`。
  - 开发者未遵循规范，随意写下了 `ml-[15px]`，加上内部 padding 后文字起始线在 25px 左右，与父级文件夹名错开 11px。
  - 缩进混乱后，为了在空状态和加载状态中强行补齐，又在 `WorkspaceTreeNode.tsx` 中增加了 `ml-[-6px]` 和 `w-[calc(100%+12px)] pl-[38px]` 这类互相抵消的几何污染代码。
- **代码级整改方案**:
  清理所有负边距与 `calc` 补丁，依照 Quiet Studio 标杆 `.thread { padding-left: 36px; }`，直接使用 `pl-[36px]` 实现严丝合缝的垂直对齐。
  ```diff
  // AgentTaskRow.tsx:109
  - isNested ? 'ml-[15px] w-[calc(100%-15px)]' : 'ml-0 w-full'
  + isNested ? 'pl-[36px] w-full' : 'pl-[10px] w-full'

  // WorkspaceTreeNode.tsx:227, 240
  - className="theme-page-workspace-tree-node-button-2 ml-[-6px] flex justify-start"
  + className="theme-page-workspace-tree-node-button-2 flex justify-start"

  - <div className="ml-[-6px] flex h-7 w-[calc(100%+12px)] items-center pl-[38px] pr-2.5 text-sm text-muted-foreground">
  + <div className="flex h-7 w-full items-center pl-[36px] pr-2.5 text-sm text-muted-foreground">
  ```

---

#### 3.1.6 S4 & S5: 顶栏分割线 hairline 退化与标题栏毛玻璃残留 (P1 次级)

- **直接代码观察**:
  1. `src/renderer/components/shell/PageHeaderLayout.tsx` (Lines 27, 39):
     ```tsx
     !tabs && divider && 'border-b border-border-subtle',
     tabs ? <div className="non-draggable border-b border-border-subtle px-4">{tabs}</div> : null
     ```
  2. `src/renderer/components/window/WindowTitleBar.tsx` (Line 87):
     ```tsx
     className="... bg-surface/35 backdrop-blur-sm"
     ```
- **根因推导 (Root Cause)**:
  - `DESIGN.md` §十二 line 505 强制门禁：“侧栏分界：侧栏 header/footer 的 hairline 使用 `--border`，不得退回到几乎不可见的 `--border-subtle`”。`border-border-subtle` 在浅色模式下几乎不可辨认，顶栏与内容表面粘连。
  - `DESIGN.md` §三.3 核心原则：“禁止毛玻璃：表面不使用 `backdrop-filter`”。`WindowTitleBar` 中残留的 `backdrop-blur-sm` 属于废止的 v3 Zenith 遗留样式。
- **代码级整改方案**:
  ```diff
  // PageHeaderLayout.tsx:27, 39
  - !tabs && divider && 'border-b border-border-subtle',
  + !tabs && divider && 'border-b border-border',

  - tabs ? <div className="non-draggable border-b border-border-subtle px-4">{tabs}</div> : null
  + tabs ? <div className="non-draggable border-b border-border px-4">{tabs}</div> : null

  // WindowTitleBar.tsx:87
  - bg-surface/35 backdrop-blur-sm
  + bg-surface
  ```

---

#### 3.1.7 A1: 左右分栏模式下双顶栏高度错位 8px (P1 次级)

- **直接代码观察**:
  `src/renderer/components/artifacts/ArtifactPanel.tsx` (Lines 427, 618):
  ```tsx
  <div
    className={`h-10 flex items-center gap-2 border-b border-border shrink-0 ${
      isMac && isTopLevelPanel ? 'pl-20 pr-3' : 'px-3'
    }`}
  >
  ```
- **根因推导 (Root Cause)**:
  当开启产物协同预览时，窗口呈现 55% 会话 / 45% 产物双栏布局。左侧 Cowork 会话的 `PageHeader` 统一高度为 **48px (`h-12`)**；而右侧 `ArtifactPanel` 顶栏高度却写死了 **40px (`h-10`)**。横贯整个视口的下边框在左右两栏交接处产生 **8px 的高度台阶断裂**，视觉极不协调。
- **代码级整改方案**:
  统一提升右侧顶栏高度为 48px (`h-12`)：
  ```diff
  // ArtifactPanel.tsx:427, 618
  - className={`h-10 flex items-center ...
  + className={`h-12 flex items-center ...
  ```

---

#### 3.1.8 C4, C6, C7, A2, A3: 芯片几何尺寸、顶栏外间距、气泡阅读栏宽度与非标文件视图 (P2 一般级)

- **C4 (`GoalModeChip.tsx`, `ActiveExpertBadge.tsx`)**: 采用 `h-6` (24px) 与 `rounded-full`，脱离 32px 控件高与 8px 圆角规范。整改为 `h-8 rounded-lg`。
- **C6 (`SecurityStatusIndicator.tsx:22`)**: 移除内联 `mr-2`，消除顶栏右侧间隙偏差。
- **C7 (`UserBubble.tsx`, `TurnBlock.tsx`)**: 将内部冗余的 `max-w-6xl` 改为与外层一致的 `max-w-4xl` (896px)。
- **A2 (`FileDirectoryView.tsx`)**: 将裸 `div role="button"` 重构为标准 `Button variant="ghost"`，用 `lucide-react` 图标替换硬编码系统 emoji。
- **A3 (`FileInfoFallback.tsx:21`)**: 移除 `text-5xl` 巨大 emoji 表情，重构为标准 shadcn/ui Empty 结构与克制尺寸图标。

---

### 3.2 设置中心与本地推理 (Settings & Local Inference)

#### 3.2.1 SET1: 设置页脚操作栏限宽 `max-w-3xl` 导致关闭按钮中途悬空 (P1 次级)

- **直接代码观察**:
  `src/renderer/components/settings/SettingsPage.tsx` (Lines 445–485):
  ```tsx
  {/* Footer */}
  <div className="shrink-0 border-t border-border bg-background px-6 py-3">
    <div className="mx-auto flex max-w-3xl items-center justify-end">
      <Button variant="outline" size="sm" onClick={onClose}>
        {i18nService.t('close')}
      </Button>
    </div>
  </div>
  ```
- **根因推导 (Root Cause)**:
  设置页面整体外层为固定/自适应宽度面板，但底部的操作工具条内部被强行锁死在 `max-w-3xl` (768px)。在宽屏或展开设置窗口时，右下角的“关闭”按钮停在 768px 位置悬空，无法贴合整个设置面板的右侧安全边距。
- **代码级整改方案**:
  ```diff
  // SettingsPage.tsx:447
    <div className="shrink-0 border-t border-border bg-background px-6 py-3">
  -   <div className="mx-auto flex max-w-3xl items-center justify-end">
  +   <div className="flex w-full items-center justify-end">
        <Button variant="outline" size="sm" onClick={onClose}>
  ```

---

#### 3.2.2 SET2: 外观设置面板内层违规冗余 `max-w-3xl` 限制 (P2 一般级)

- **直接代码观察**:
  `src/renderer/components/settings/appearance/AppearanceSettingsPanel.tsx` (Line 79):
  ```tsx
  <div className="grid max-w-3xl grid-cols-1 gap-8 md:grid-cols-2">
  ```
- **根因推导 (Root Cause)**:
  违反 DESIGN.md 第 548 行明确规则：“外观设置面板：禁止在主网格内再套 `max-w-3xl`；面板外层已有统一 `max-w-3xl`，内层再限宽会导致窗口放大时右侧出现大片异常空白”。
- **代码级整改方案**:
  移除 `max-w-3xl`，保持 `w-full`：
  ```diff
  // AppearanceSettingsPanel.tsx:79
  - <div className="grid max-w-3xl grid-cols-1 gap-8 md:grid-cols-2">
  + <div className="grid w-full grid-cols-1 gap-8 md:grid-cols-2">
  ```

---

#### 3.2.3 SET3: 快捷键面板 FieldContent 触发顶部对齐覆盖 `items-center` (P1 次级)

- **直接代码观察**:
  `src/renderer/components/settings/shortcuts/ShortcutsSettingsPanel.tsx` (Lines 88–112):
  ```tsx
  <Field key={shortcut.id} className="theme-field-companion flex-row items-center justify-between py-2">
    <FieldLabel className="cursor-pointer">{shortcut.name}</FieldLabel>
    <FieldContent className="flex items-center gap-1.5">
      <kbd className="theme-kbd ...">{shortcut.key}</kbd>
    </FieldContent>
  </Field>
  ```
- **根因推导 (Root Cause)**:
  `@shared/components/ui/field.tsx` 中定义了复杂的子槽位选择器：`has-[>[data-slot=field-content]]:items-start`。当在子元素中套用 `<FieldContent>` 时，会根据 CSS 特异性强行将 `<Field>` 的对齐方式重置为顶部对齐 (`items-start`)，覆盖了行内的 `items-center`，造成快捷键按键胶囊偏向上方、基线错落。
- **代码级整改方案**:
  在 Field 上使用 `!items-center` 提升权重，或使用标准 `div` 代替 `<FieldContent>`：
  ```diff
  // ShortcutsSettingsPanel.tsx:88
  - <Field key={shortcut.id} className="theme-field-companion flex-row items-center justify-between py-2">
  + <Field key={shortcut.id} className="theme-field-companion flex-row !items-center justify-between py-2">
      <FieldLabel className="cursor-pointer">{shortcut.name}</FieldLabel>
  -   <FieldContent className="flex items-center gap-1.5">
  +   <div className="flex items-center gap-1.5">
        <kbd className="theme-kbd ...">{shortcut.key}</kbd>
  -   </FieldContent>
  +   </div>
    </Field>
  ```

---

#### 3.2.4 SET4: 邮箱高级设置 4px 缩进不对齐与违规卡片化 (P1 次级)

- **直接代码观察**:
  `src/renderer/components/settings/email/EmailAdvancedFields.tsx` (Lines 106, 122–140):
  ```tsx
  <CollapsibleContent className="space-y-4 px-1 pb-1 pt-2">
  ...
  <div className="theme-scene-email-field flex items-center justify-between">
    <Label htmlFor="email-ssl" ...>{...}</Label>
    <Switch id="email-ssl" ... />
  </div>
  ```
- **根因推导 (Root Cause)**:
  1. `CollapsibleContent` 添加了 `px-1` (4px)，导致展开的高级字段左边界与基础字段缩进错开 4px，破坏了左侧铅垂对齐线；
  2. 开关选项使用了 `.theme-scene-email-field` 独立卡片化外框，违反 DESIGN.md「设置页行式列表为主，不套多余卡片」原则。
- **代码级整改方案**:
  移除 `px-1`，移除卡片外框，采用标准行式 `Field flex-row items-center justify-between py-3`。

---

#### 3.2.5 SET5: 即时通讯 (IM) 设置左右边距 32px vs 8px (4:1) 严重不对称 (P2 一般级)

- **直接代码观察**:
  `src/renderer/components/settings/im/IMSettings.tsx` (Lines 210–230):
  ```tsx
  <div className="flex h-full min-h-0 flex-1 flex-col gap-4 pl-4 pr-2">
  ```
- **根因推导 (Root Cause)**:
  设置区域左侧有 `pl-4` 且与左侧导航列表间距已有 `gap-4`，导致左侧总留白达到 32px，而右侧只有 `pr-2` (8px)，左右视觉留白比为 4:1，极不平衡。
- **代码级整改方案**:
  统一改为对称水平内边距 `px-4`。

---

#### 3.2.6 SET6: 记忆编辑弹窗继承 `sm:max-w-sm` (384px) 违规窄窗 (P1 次级)

- **直接代码观察**:
  `src/renderer/components/settings/memory/ManagedMemorySettings.tsx` (Lines 66–98):
  ```tsx
  <DialogContent className="theme-control-card-surface">
    <DialogHeader>
      <DialogTitle>{i18nService.t('memoryEditTitle')}</DialogTitle>
    </DialogHeader>
    <div className="space-y-4 py-2">
      {/* 包含 键、主题、值、标签等多个复杂表单字段 */}
    </div>
  ```
- **根因推导 (Root Cause)**:
  `DialogContent` 没有指定任何 `sm:max-w-*` 类，回退继承 `dialog.tsx` 的默认值 `sm:max-w-sm` (384px)。该弹窗为包含 4 个表单项的多字段复杂编辑窗，384px 导致输入框极度拥挤，严重违反 DESIGN.md「表单弹窗最小宽度 448px，多字段弹窗推荐 512px (`sm:max-w-lg`)」基准。
- **代码级整改方案**:
  显式指定 `sm:max-w-lg` (512px)。

---

#### 3.2.7 SET7: 模型服务商编辑弹窗禁用字号 `text-[10px]` 与整窗滚动缺陷 (P1 次级)

- **直接代码观察**:
  `src/renderer/components/settings/model/ProviderEditDialog.tsx` (Lines 525, 650, 658):
  ```tsx
  <span className="... text-[10px] font-medium ...">
  ```
- **根因推导 (Root Cause)**:
  违反 AGENTS.md / DESIGN.md 铁律：“禁止出现 `<12px` 字号（如 `text-[10px]`、`text-[11px]`）”。另外，Line 525 整个 `DialogContent` 带有 `max-h-[85vh] overflow-y-auto`，导致头部标题与底部保存按钮随着表单一同滚动移出可视区域。
- **代码级整改方案**:
  字号改为 `text-xs` (12px)；将滚动区下放至内容主体 `flex-1 overflow-y-auto`，Header 和 Footer 保持吸顶/吸底固定。

---

#### 3.2.8 SET8, LI1, LI3: 空状态居中割裂、标题/描述对齐分歧与 EmptyMedia 槽位混乱 (P1/P2)

- **SET8 (`ModelRoutingUsageSections.tsx`, `ModelCatalogBrowser.tsx`)**: 在调用统计与模型筛选无结果时，直接渲染普通左对齐 `<p>` 标签，破坏中轴对齐。整改为 `@shared/components/ui/empty`。
- **LI1 (`ModelStartedDialog.tsx:52-65`)**: `DialogTitle` 设置了 `text-center`，但 `DialogDescription` 保持默认靠左，视觉重心割裂。整改为二者统一居中。
- **LI3 (`ModelsPanel.tsx:140-155`)**: `EmptyMedia` 被放置在 `EmptyHeader` 外部，违反 shadcn/ui 规范中统一 flex 间距结构。整改为将 `EmptyMedia` 移至 `EmptyHeader` 内部。

---

#### 3.2.9 SET9 & LI2: 右侧控件宽度锯齿跳动与原生 HTML input 高度不合规 (P2 一般级)

- **SET9 (`MagpiePreferenceControls.tsx:120-165`)**: 混合使用 `lg:w-64`, `lg:w-40`, `lg:w-48`, `lg:w-80`，右边缘呈犬牙错乱。桌面端统一定义为 `sm:w-64` (256px)。
- **LI2 (`ModelContextSettingsModal.tsx:78-85`)**: 原生 HTML `<input>` 硬编码 `h-7` (28px) 且 MoE 与上下文行间距不一 (gap-0 vs gap-2)。整改引入标准 `<Input className="h-8 w-24 text-sm" />` 并统一 `gap-2`。

---

### 3.3 全局模态框与弹窗系统 (Modals & Dialogs Design Standards)

#### 3.3.1 DLG1: DestructiveConfirmDialog 宽度违规 (384px) 与警告文字 `truncate` 粗暴截断安全隐患 (P0 严重级)

- **直接代码观察**:
  `src/shared/components/ui/destructive-confirm-dialog.tsx` (Lines 54, 60):
  ```tsx
  <DialogContent className={cn('max-w-sm', ...)}>
    ...
    <DialogDescription className="text-xs text-muted-foreground truncate">
      {description}
    </DialogDescription>
  ```
- **根因推导 (Root Cause)**:
  1. 采用 `max-w-sm` (384px)，违反 DESIGN.md「表单与确认弹窗最小宽度 448px」门禁；
  2. **严重安全与可用性隐患**：警告描述文本添加了 `truncate` 单行截断类！当用户删除重要会话、任务或配置时，解释不可逆后果的关键说明被粗暴截断为省略号 `...`，用户根本无法看清删除后果！
- **代码级整改方案**:
  ```diff
  // destructive-confirm-dialog.tsx:54, 60
  - <DialogContent className={cn('max-w-sm', ...)}>
  + <DialogContent className={cn('sm:max-w-md', ...)}>
      ...
  -   <DialogDescription className="text-xs text-muted-foreground truncate">
  +   <DialogDescription className="text-sm text-muted-foreground whitespace-normal break-words">
        {description}
      </DialogDescription>
  ```

---

#### 3.3.2 DLG2: SessionExportDialog 严重超窄 (320px) 违规 (P1 次级)

- **直接代码观察**:
  `src/renderer/components/cowork/sessionDetail/SessionExportDialog.tsx` (Line 50):
  ```tsx
  <DialogContent className="sm:max-w-xs">
  ```
- **根因推导 (Root Cause)**:
  `sm:max-w-xs` 仅有 **320px** 宽！内含多行导出格式选项，操作按钮文本被严重挤压换行，完全违背「舒展大气」基准。
- **代码级整改方案**:
  升级为 `sm:max-w-md` (448px)。

---

#### 3.3.3 DLG3: 浮动页脚 8px 悬空凹坑缺陷 (The 8px Footer Gutter Flaw) (P0 严重级)

- **涉及文件**:
  1. `src/renderer/components/skills/CreateSkillDialog.tsx` (Lines 92, 160)
  2. `src/renderer/components/mcp/ImportMcpDialog.tsx` (Lines 75, 140)
  3. `src/renderer/components/expert/CreateExpertDialog.tsx` (Lines 180, 520)
- **代码特征**:
  ```tsx
  <DialogContent className="p-6 ...">
    ...
    <DialogFooter>
      <Button ...>取消</Button>
      <Button ...>确定</Button>
    </DialogFooter>
  </DialogContent>
  ```
- **根因推导 (Root Cause)**:
  `@shared/components/ui/dialog.tsx` 中定义的 `DialogFooter` 在 `surface={DialogFooterSurface.Default}` 时自带 `-mx-4 -mb-4 p-4` 负外边距。该样式专为标准 `p-4` 内边距弹窗设计（通过 -16px 抵消外层 16px 实现贴边）。  
  然而，上述三个弹窗将 `DialogContent` 显式设为 `p-6` (24px)！  
  导致计算公式为：`24px (外层 padding) - 16px (负外边距) = 8px`！  
  **严重视觉缺陷：弹窗底部的灰色页脚条左右和下方都出现了 8px 的奇怪白色边隙（凹坑），页脚无法贴合弹窗边缘，按钮与边框产生错位！**
- **代码级整改方案**:
  在 `DialogFooter` 上指定 `surface={DialogFooterSurface.Seamless}` 并统一设定 `px-6 pb-6 pt-4`，或者传入自定义补偿 `-mx-6 -mb-6 px-6 py-4`，彻底消除 8px 凹缝。

---

#### 3.3.4 DLG7: Tailwind `sm:` 媒体查询特异性覆盖陷阱 (P0 严重级)

- **涉及文件**:
  - `src/renderer/components/coding/CodingAuthTerminalDialog.tsx` (Line 40)
  - `src/renderer/components/coding/codingWorkbenchDialogs.tsx` (Line 56, `CodingLaneChangesDialog`)
- **直接代码观察**:
  ```tsx
  <DialogContent className="max-w-3xl">
  ```
- **根因推导 (Root Cause)**:
  `dialog.tsx` 的基础类包含带断点前缀的 `sm:max-w-sm`。由于 Tailwind CSS 中响应式前缀 `sm:` 对应 `@media (min-width: 640px)`，在 CSS 规则生成顺序与特异性上高于无前缀的工具类。直接传入裸 `max-w-3xl` 会被 `sm:max-w-sm` 在 `>=640px` (桌面端) 上**强行覆盖失效**！终端弹窗和代码差异对比窗在桌面端被压成只有 384px 的窄条！
- **代码级整改方案**:
  必须携带 `sm:` 前缀：
  ```diff
  - <DialogContent className="max-w-3xl">
  + <DialogContent className="sm:max-w-3xl">
  ```

---

#### 3.3.5 DLG4: 手写全屏遮罩与三段式边距锯齿 (px-5, px-8, px-6) (P1 次级)

- **涉及文件**:
  `src/renderer/components/skills/SkillDocumentDialog.tsx`, `MarketplaceSkillDocumentDialog.tsx` (Lines 80–140)
- **根因推导 (Root Cause)**:
  1. 未使用系统规范的 `<Dialog>` 组件，而是手写 `fixed inset-0` 与遮罩层；
  2. 弹窗的 Header 水平内边距为 20px (`px-5`)，Body 突然跳到 32px (`px-8`)，Footer 又变为 24px (`px-6`)。视线从上往下扫描时，左右起始边缘呈现明显的锯齿形错位。
- **代码级整改方案**:
  重构为标准 `<Dialog>`，各段水平内边距严格统一为 `px-6` (24px)。

---

#### 3.3.6 DLG5: 屏幕水平居中叠加 `mx-4` 导致弹窗向右偏离中轴 16px (P1 次级)

- **直接代码观察**:
  `src/renderer/components/skills/manager/RemoteImportModal.tsx` (Lines 48, 52):
  ```tsx
  return createPortal(
    <Modal ... className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 mx-4 w-full max-w-lg ...">
  ```
- **根因推导 (Root Cause)**:
  元素已经通过 `left-1/2 -translate-x-1/2` 实现了 CSS 几何正中居中，但类名中却多加了 `mx-4`。在 `-translate-x-1/2` 之后再加上 `mx-4` 会使整个弹窗向右偏离屏幕中心点 16px！此外还冗余嵌套了 `createPortal`。
- **代码级整改方案**:
  移除外层多余的 `createPortal`，移除 `mx-4`，保证几何居中。

---

#### 3.3.7 DLG6 & DLG8: McpOfficialConnectDialog 416px 违规与恢复/冲突弹窗回退 (P1 次级)

- **DLG6 (`McpOfficialConnectDialog.tsx:60`)**: 宽度设为 `max-w-[26rem]` (416px)，低于 448px 门禁。升级为 `sm:max-w-md` (448px)。
- **DLG8 (`codingWorkbenchDialogs.tsx`, `FailureDetailModal.tsx`)**: 恢复/冲突弹窗以及崩溃日志展示弹窗缺少宽度声明，回退至 384px。分别升级为 `sm:max-w-lg` (512px) 与 `sm:max-w-xl` (576px)。

---

#### 3.3.8 SP1 & SP2: McpCustomTab 工具栏破坏双列网格 (P0) 与 ExpertView Tab 边距横向跳变 (P1)

- **SP1 (`McpCustomTab.tsx:46-76`)**:  
  父容器是 `grid grid-cols-1 md:grid-cols-2`。操作按钮栏 `<div className="flex flex-wrap gap-2">` 没有加 `col-span-full`！被 CSS Grid 当成了一个卡片，塞进了第一行第一列！第一张真正的服务器卡片被挤到了第一行第二列！卡片网格彻底错位。整改为将按钮栏移出 grid 或显式添加 `col-span-full mb-1`。
- **SP2 (`ExpertView.tsx:89, 98, 117`)**:  
  Experts Tab 为 `px-4 sm:px-6`，Skills Tab 为 `px-6`，Mcp Tab 为 `px-4`。顶部切换 Tab 时，主内容区左右边缘出现 8px 横向跳变。整改统一为 `px-4 sm:px-6 py-4`。

---

### 3.4 Figma 设计系统现代化与 Auto Layout 重构 (Figma Modernization)

#### 3.4.1 FIG1: 页面级画板 100% 绝对定位假布局现状与 Auto Layout 架构重构 (P0 严重级)

- **现状诊断**:  
  当前 Figma 项目中核心画板（首页 `6:131`、深色首页 `7:105`、任务会话 `12:275`、设置中心 `9:107`、本地推理 `24:301`）均为纯静态固定坐标系（Frame with Absolute Children），完全未使用 Auto Layout。一旦内容增删或多语言换行，所有下方与右侧图层无法流式重排，发生穿模重叠。
- **目标重构参数 (R3 规范)**:
  - 根画板配置 Auto Layout `HORIZONTAL`，`padding=[8, 8, 8, 8]`，`itemSpacing=0`；
  - 侧边栏框架设为 `layoutSizingHorizontal: FIXED (260px)`, `layoutSizingVertical: FILL`；
  - 主工作台舞台容器设为 `layoutSizingHorizontal: FILL`, `layoutSizingVertical: FILL`，圆角 12px，内部开启 Auto Layout `VERTICAL` 居中流。

---

#### 3.4.2 FIG2, FIG3, FIG4: 1px 水平偏心根因推导与对称对齐修正 (P1 次级)

- **几何推导与根因**:
  主舞台容器宽度为 1012px（偶数）：
  - **核心输入岛 (`6:257`)**: 宽 768px。理想居中左边距为 `(1012 - 768) / 2 = 122px`。Figma 坐标为 `left: 121px`（右余 123px），**偏左 1px**；
  - **时段问候语 (`6:255`)**: 宽 288px。理想居中左边距为 `(1012 - 288) / 2 = 362px`。Figma 坐标为 `left: 361px`（右余 363px），**偏左 1px**；
  - **副标题 (`6:256`)**: 宽 378px。理想居中左边距为 `(1012 - 378) / 2 = 317px`。Figma 坐标为 `left: 316px`（右余 318px），**偏左 1px**；
  - **快捷动作胶囊组 (`6:265`)**: 6 个胶囊总宽 690px。理想居中左边距为 `(1012 - 690) / 2 = 161px`。Figma 坐标为 `left: 160px`（右余 162px），**偏左 1px**。
- **重构方案**:
  无需手工修正整数绝对坐标。将上述元素统一收纳进 Auto Layout 垂直居中流，设置 `counterAxisAlignItems: CENTER`，Figma 自动计算亚像素对称居中。子胶囊设置 `Hug contents` 支撑自适应文案宽度。

---

#### 3.4.3 FIG5: 输入岛内部操作工具栏 Y 轴垂直基线 7px 落差修正 (P1 次级)

- **现状诊断**:  
  在核心输入岛 `6:257` (`w=768, h=136`) 底部操作栏：
  - 附件添加图标 `＋` (`6:261`): `top: 98px`；
  - 工作区与模型选择器 (`6:259`): `top: 100px`；
  - 发送圆形按钮 32×32 (`6:263`): `top: 93px`。  
  同一行底栏控件垂直基线最大落差达 **7px**，视觉严重晃动。
- **重构方案**:
  底部工具行开启 Auto Layout `HORIZONTAL`，`alignItems: CENTER`，`justifyContent: SPACE_BETWEEN`，高度统一定义为 32px，彻底齐平垂直基线。

---

#### 3.4.4 FIG6: 任务会话阅读流 896px (`max-w-4xl`) 规范化与消除 12px 非对称边距 (P0 严重级)

- **现状诊断**:  
  DESIGN.md 明确规定任务流采用 `max-w-4xl mx-auto`（即 896px 对称居中阅读列）。Figma 中实测：底部输入框 `12:334` 宽 872px (`left: 69px`)；工具执行状态条 `13:101` 宽 860px (`left: 70px`，右余 82px，非对称偏差达 12px！)。
- **重构方案**:
  创建标准会话流容器，宽度设定为 **896px**，`counterAxisAlignItems: CENTER`。流内所有子卡片（用户提问气泡、思考行、工具条、权限申请卡）全部设为 `layoutSizingHorizontal: FILL` (100% 撑满 896px)。

---

#### 3.4.5 FIG7 & FIG8: 基础组件母版固定宽度僵死缺陷重构 (P1 次级)

- **FIG7 (侧栏导航行 `4:34`)**: 母版写死 `w=224`，无法撑满侧栏 244px 可用空间。重构为 `layoutSizingHorizontal: FILL`，内边距规范为 `px=10, py=6, gap=10`。
- **FIG8 (通用按钮 `4:60`)**: 母版写死 `w=112`，短文本冗余空白、长文本溢出。重构为 `layoutSizingHorizontal: HUG` (Hug contents)，左右内边距统一为 12px (`px-3`)，间距 8px (`gap-2`)。

---

#### 3.4.6 FIG9: 设置中心 5px~25px 边缘锯齿与伪造滚动负坐标重构 (P1 次级)

- **现状诊断**:  
  设置内容区容器 `9:176` (`w=744`)、设置项母版 `9:100` (`w=720`)、设置底栏 `9:217` (`w=792`) 宽度各不相同；底栏关闭按钮与上方内容右边界错位 5px~25px。且为了表现滚动，画板硬编码复制了 `y="-350"` 的伪造画板。
- **重构方案**:
  设置主画板开启 Auto Layout，右侧内容区内部设为 Auto Layout `VERTICAL`，设置行与底栏全部设为 `layoutSizingHorizontal: FILL`，底栏按钮设为 `justifyContent: FLEX_END` 保证右对齐；滚动行为通过单一画板配置 `Overflow: Vertical scrolling`。

---

#### 3.4.7 FIG10: 基础弹窗母版体系补齐 (448px Base) 与业务弹窗 (672px→512px) 治理 (P0 严重级)

- **现状诊断**:  
  Figma 基础组件库完全缺失 `EditProjectDialog` (448px) 与 `DestructiveConfirmDialog` 标准弹窗母版；业务弹窗 `16:1008` 宽做成非标 672px，导致分钟输入项右侧溢出弹窗边界。
- **重构方案**:
  1. 新建 `Dialog / Form / 448` 标准母版（`w=448`, `cornerRadius=12`, 垂直 Auto Layout，标准 Header/Body/Footer 结构）；
  2. 新建 `Dialog / Confirm / 448` 破坏性确认母版；
  3. 将业务弹窗 `16:1008` 重构为标准 512px 弹窗，内部输入框改为 `FILL`，防止文字溢出。

---

#### 3.4.8 FIG11: 本地推理模型卡片网格 Auto Layout Wrap/Grid 重构 (P1 次级)

- **现状诊断**:  
  `25:291` 内部 6 张卡片全部用绝对坐标写死。一旦卡片描述文字折行变高（如从 196px 变为 228px），下方第二行卡片无法自适应下移，产生垂直重叠碰撞。
- **重构方案**:
  卡片网格容器开启 Auto Layout `HORIZONTAL (Wrap)` 或等宽 Grid，间距设为固定 `gap=16`，保证动态内容高度自适应流动。

---

## 4. 全生命周期验收与追溯检查清单 (Requirements Traceability & Verification Checklist)

### 4.1 Requirement R1: 系统化布局居中与对齐审计全覆盖追溯

- [x] **R1.1 视图与组件扫描覆盖率 100%**:
  - `src/renderer/components/cowork/` 全量排查完成（确认 C1-C7）。
  - `src/renderer/components/shell/`, `agentSidebar/`, `window/` 全量排查完成（确认 S1-S5）。
  - `src/renderer/components/artifacts/` 全量排查完成（确认 A1-A3）。
  - `src/renderer/components/settings/` 全量排查完成（确认 SET1-SET9）。
  - `src/renderer/components/localInference/` 全量排查完成（确认 LI1-LI3）。
  - 全局模态框、专用视图与通用弹窗全量排查完成（确认 DLG1-DLG8, SP1-SP2）。
  - Figma 设计项目 `l1IdC96sLjXx5CfPwcG4pQ` 6 大核心画板全量走查完成（确认 FIG1-FIG11）。
- [x] **R1.2 缺陷台账编制完成**:
  - 48 项缺陷均已归入结构化矩阵，标明组件、代码行号、缺陷类别、严重度级别及根因推导。

---

### 4.2 Requirement R2: 代码修复规范与回归验证指令集

在实施人员（implementer）执行代码修复后，必须依照以下指令集执行严格的回归验证，任何一项失败即阻断合并：

#### 1. 静态代码与主题审计门禁 (Lint & Theme Check)
```bash
bun run lint
```
- **通过标准**: 
  - Oxlint 检查 0 错误、0 警告；
  - `theme:check` 与 `theme:audit` 必须 100% 通过；
  - 严禁出现未授权的局部 CSS、任意值类（如 `ml-[15px]`）或禁用字号（`text-[10px]`）。

#### 2. 代码格式与风格验证 (Format Check)
```bash
bun run format:check
```
- **通过标准**: oxfmt 检查通过，代码符合仓库格式规范。

#### 3. 单元测试与流式守护测试 (Unit Tests)
```bash
bun run test:unit
```
- **通过标准**: 全部 Vitest 单元测试通过，确保重构未破坏 Cowork 会话状态流、组件 props 契约与流式渲染。

#### 4. 无头浏览器浅色/深色巡检 (Browser Preview Walkthrough)
```bash
bun run web:preview:check
```
- **通过标准**: 
  - Playwright 在无头 Chromium 中完整走查主要界面；
  - 浅色模式与深色模式下均 0 `console.error`、0 `pageerror`；
  - Preload 契约检查通过。

#### 5. 1280×800 标准桌面分辨率视觉复核 (Visual Inspection)
- 启动本地预览：`bun run web:preview`；
- 浏览器视口设定为 1280×800；
- **目视基准走查**:
  - [ ] **侧栏起始线**: 新建任务、搜索、功能导航行文字起始线严格对齐在 36px 垂直线上；
  - [ ] **树形缩进**: 展开文件夹后，子任务行文字与父文件夹名严格对齐；
  - [ ] **会话流质心**: 消息气泡、工具条与底部悬浮输入框水平绝对居中，两侧留白均为对称的 16px；
  - [ ] **快捷动作**: 大屏 (≥1280px) 下快捷胶囊呈现单行居中排布，无孤立折行；
  - [ ] **双顶栏齐平**: 开启产物分栏时，左右两栏顶栏高度均为 48px，下边框横向完全贯通；
  - [ ] **弹窗舒展度**: 所有表单弹窗与确认弹窗宽度 ≥448px，无 8px 悬空凹缝，警告文字完整自适应换行。

---

### 4.3 Requirement R3: Figma 设计系统同步标准与验收步骤

设计人员或重构脚本执行 Figma 改造时，按以下规范与步骤逐项对齐：

1. **画板 Auto Layout 现代化**:
   - 对 `6:131`, `7:105`, `12:275`, `9:107`, `24:301` 开启 Auto Layout；
   - 彻底废除手工坐标计算，由 Flex 弹性盒自适应驱动。
2. **1px 偏心消除**:
   - 输入岛 (`6:257`)、问候语 (`6:255`)、副标题 (`6:256`)、快捷动作 (`6:265`) 放入 Auto Layout 居中流，`counterAxisAlignItems: CENTER`。
3. **896px 会话阅读列**:
   - 会话内容流宽度重构为 896px (`max-w-4xl`)，消除 12px 左右偏差。
4. **弹窗母版库创建**:
   - 在 Page 01 (基础组件) 中建立 `Dialog / Form / 448` 与 `Dialog / Confirm / 448` 标准母版；
   - 替换历史业务弹窗，统一对齐 448px/512px 规范。
5. **母版约束弹性化**:
   - 侧栏导航行母版设为 `Fill container` (244px)；
   - 按钮母版设为 `Hug contents`；
   - 权限申请卡设为 `Fill container`。

---

**报告编制结论**：  
本审计报告已建立起代码库与设计稿之间完整的 48 项缺陷溯源链条，为彻底消除布局不对称、提升知远智能体专业桌面级体验奠定了坚实的工程规范基础。
