# 知远智能体 (ZhiYuan Agent) · 未覆盖事项台账与二期工程落地指南 (Gap Ledger)

> **版本**：v4.0.0 (Quiet Studio)  
> **审计日期**：2026-11-05  
> **执行角色**：Teamwork Worker (Implementer, QA, Specialist)  
> **规范依据**：`DESIGN.md` (v4.0 Quiet Studio), `AGENTS.md` (Enterprise Policy & Frontend P0 Rules)  
> **目标 Figma 项目**：`l1IdC96sLjXx5CfPwcG4pQ`（[知远智能体 — 产品现状与设计重构](https://www.figma.com/design/l1IdC96sLjXx5CfPwcG4pQ/知远智能体-—-产品现状与设计重构?node-id=0-1&p=f&t=BUtatH2p9uYgPDiH-0)）

---

## 目录

1. [台账定位与管理原则](#1-台账定位与管理原则)
2. [范围外与有意延期事项清单 (Out of Scope & Deferred Items)](#2-范围外与有意延期事项清单-out-of-scope--deferred-items)
   - 2.1 企业扩展模块 (`enterprise/`) 的边界豁免声明
   - 2.2 废弃的历史 v3 发光与毛玻璃 Token
   - 2.3 小众 CAD (DXF) 与专业工程渲染器深度交互
3. [系统技术债务与极端边界情况分析 (Technical Debt & Edge Cases)](#3-系统技术债务与极端边界情况分析-technical-debt--edge-cases)
   - 3.1 llama.cpp 异构多 GPU 切分与显存分配边缘场景
   - 3.2 大文件模型断点续传与网络震荡恢复
   - 3.3 自定义 MCP 服务器 Stdio 沙箱跨平台权限差异
   - 3.4 高频流式打字与虚拟化列表贴底锚定
4. [二期工程落地路线图 (Phase 2 Implementation Roadmap)](#4-二期工程落地路线图-phase-2-implementation-roadmap)
   - Phase 2.1：零破坏清理（违规呼吸动效移除与搜索吞没修复）
   - Phase 2.2：服务商配置列表 32px 标准化重构
   - Phase 2.3：Cowork 会话内原地拉起本地模型闭环
   - Phase 2.4：架构级融合 —— 统一模型中心 (Model Hub) 视图
5. [前端开发者工程落地准则 (Engineering Landing Guidelines)](#5-前端开发者工程落地准则-engineering-landing-guidelines)

---

## 1. 台账定位与管理原则

在大型系统的架构演进与体验重构过程中，清晰定义**哪些在本次完成**、**哪些因架构边界有意不纳入**以及**哪些作为二期工程落地**，是保证项目透明度、工程严谨性与审计合规性的核心。

本台账严格遵循以下原则：
- **边界明确**：凡有明确仓库规范（如 `AGENTS.md` 对 `enterprise/` 的特殊定义）排除的内容，明确列出政策依据与豁免范围；
- **真实记录**：不隐瞒任何未解决的技术债、边缘缺陷或小众场景；
- **指导工程**：给出详尽的二期实施路径与前端代码编写准则，确保后续工程师接手时不发生规范劣化。

---

## 2. 范围外与有意延期事项清单 (Out of Scope & Deferred Items)

### 2.1 企业扩展模块 (`enterprise/`) 的边界豁免声明
- **涉及模块**：仓库根目录下 `enterprise/`（包括 `enterprise/src/`、企业会话、托管模型投影、企业控制循环及独立设置）。
- **排除原因与政策依据**：
  - 根据 `AGENTS.md`「企业扩展（enterprise/）」章节的明确硬性规定：
    > `enterprise/` 是知远企业客户端扩展（自 zhiyuanAaaS 仓库迁入，源提交 `7adec4a`）...迁移代码保持原仓库结构（`enterprise/src/`），**不适用本仓 renderer 的主题与设计体系**。独立构建：`bun run build:enterprise` 产出 `enterprise/dist/extension.cjs` 与 `enterprise/dist/ui/`...UI bundle 是独立 document，**不进入主渲染器主题系统**...打包产物有意不含 Admin Console bundle（控制台仍是 zhiyuanAaaS 的 Web 部署应用）。
- **审计结论**：
  `enterprise/` 代码属于独立外挂扩展包，拥有其独立的企业级生命周期与样式上下文，**有意排除在本次 Quiet Studio v4.0 渲染器主题迁移与全仓 Figma 设计体系之外**。后续开发不得强行向其注入主应用 CSS 变量或改动其独立编译链路。

---

### 2.2 废弃的历史 v3 发光与毛玻璃 Token
- **涉及项**：Zenith 历史设计体系中的发光滤镜（`glow-blue`, `glow-purple`）、蓝紫渐变色、大面积毛玻璃（`backdrop-filter: blur(16px)`）以及放大 30% 的特大字阶。
- **排除原因与政策依据**：
  - 根据 `AGENTS.md`「主界面参考标杆」与 `DESIGN.md` v4.0 的权威确立：
    > 用户审阅 v3 主界面后授权废止 Zenith 的毛玻璃、渐变主按钮、外发光、悬停上浮和放大 30% 字阶，确立 v4.0 Quiet Studio 标准。
- **审计结论**：
  历史发光与渐变样式已被正式废弃并实施焦土政策，不应在 Figma 设计体系中作为有效组件复活，亦不得在未来 UI 中重新引入。

---

### 2.3 小众 CAD (DXF) 与专业工程渲染器深度交互
- **涉及模块**：`src/renderer/components/artifacts/renderers/DxfRenderer.tsx` 与相关 Web Worker 渲染管道。
- **排除范围**：
  - 本次已完成 10 大核心工件渲染器在 Figma 视口与全屏模式下的高保真画板迁移（HTML、React 沙箱、SVG、Mermaid、Code、Markdown、PDF、Docx、Excel、3D 模型）。
  - 对于 CAD 工程图纸（DXF），目前维持其基于独立 Web Worker 异步解析为二维 Canvas 矢量的能力；针对多图层开关、BIM 实体剖切、尺寸动态标注等重型 CAD 交互，判定为专业垂直领域需求，本次予以延期，不纳入通用 Agent 体验重构核心链路。

---

## 3. 系统技术债务与极端边界情况分析 (Technical Debt & Edge Cases)

在深入分析主进程与渲染器交互链路后，梳理出 4 个需要长期关注与阶段性攻克的系统技术债务：

### 3.1 llama.cpp 异构多 GPU 切分与显存分配边缘场景
- **现状分析**：
  - 当前主进程 `src/main/libs/llamacppManager/` 能够准确探测系统显卡（NVIDIA / Apple Silicon / AMD），并计算通用单卡显存水位与每层 GPU 卸载（`n_gpu_layers`）。
  - **边缘缺陷**：当用户机器存在多块不同规格显卡（例如 Intel 核显 + NVIDIA RTX 4090，或双路不同显存 GPU）时，llama.cpp 底层的张量切分（`--tensor-split`）目前采用均分或简单比例，缺少前端 UI 供高级用户精确指定每块 GPU 的显存分配上限，偶发显存溢出（OOM）。
- **后续解法**：在模型检查器（`ModelInspectorSidebar.tsx`）的「高级引擎设置」中，为多卡用户追加分卡显存分配滑块。

---

### 3.2 大文件模型断点续传与网络震荡恢复
- **现状分析**：
  - 模型市场优先采用 ModelScope（魔搭社区）进行国内高速下载，大模型文件（4GB~32GB）通常按 chunk 分块拉取。
  - **边缘缺陷**：若用户在下载过程中遭遇 Wi-Fi 彻底断开或进入系统休眠，IPC 通道 `onPullProgress` 可能会在超时后挂起。前端虽然提供了取消按钮，但若未触发重连机制，部分残缺的 `.part` 文件可能留在模型目录中，导致再次下载时报文件占用或校验失败。
- **后续解法**：主进程下载器增强分块 SHA-256 断点校验（Resume Chunk Checksum），在网络恢复时自动静默续传，避免从零重新下载数十 GB 文件。

---

### 3.3 自定义 MCP 服务器 Stdio 沙箱跨平台权限差异
- **现状分析**：
  - MCP 连接器管理（`McpManager.tsx`）允许用户配置自定义 Stdio 进程（如 Node/Python 脚本）。
  - **边缘缺陷**：在 macOS 下受限于 Electron 的 Sandbox 与权限策略，Stdio 进程无法直接读取受保护的系统目录（如用户 Desktop 或 Downloads），除非明确授权；而在 Windows 下路径分隔符（`\` 与 `/`）与环境变量展开机制不同，可能导致自定义脚本在跨平台同步配置后无法拉起。
- **后续解法**：在添加 MCP 页面增加跨平台路径预检与环境连通性探针（Dry-run Probe）。

---

### 3.4 高频流式打字与虚拟化列表贴底锚定
- **现状分析**：
  - Cowork 消息流严格贯彻全链路增量 UIMessageChunk 架构（16ms 批处理合并推送）。
  - **边缘缺陷**：在极端高吞吐模型（如 150+ tokens/s 的本地小模型）快速生成时，若虚拟化列表高度计算与用户向上微滚操作恰好重合，偶发出现 1~2 帧的贴底判定抖动（Scroll Jitter）。
- **后续解法**：强化 `VirtualizedTurnList` 的滚动锚定算法（Scroll Anchoring），只要用户未主动向上滚动超过 80px，均强制吸附贴底。

---

## 4. 二期工程落地路线图 (Phase 2 Implementation Roadmap)

基于本次完整的盘点、审计与 Figma 提案设计，制定四步走的工程落地实施路线图：

```
+───────────────────────────────────────────────────────────────────────────────────+
| Phase 2 实施路线图                                                                |
+───────────────────────────────────────────────────────────────────────────────────+
| 阶段 2.1: 零破坏规范清理 (1 周)                                                   |
| - 移除 ModelsPanel.tsx:563 呼吸动画，替换为静态 6px 语义指示点                    |
| - 修复 MarketplacePanel.tsx:321 搜索错误被假空状态吞没问题                        |
| - 验收指标: bun run lint 保持 0 错误，用户体验消除视觉骚扰与错误谎报               |
+───────────────────────────────────────────────────────────────────────────────────+
| 阶段 2.2: 控件标准化与无障碍重构 (2 周)                                           |
| - 按照 Figma 提案 34:934 重构 ProviderEditDialog.tsx                              |
| - 将 14px 细碎按钮重构为 32px 标准行式列表，补齐键盘焦点环与屏幕朗读标签          |
| - 优化 ModelInspectorSidebar.tsx 标签分行排版 (提案 26:1684)                      |
+───────────────────────────────────────────────────────────────────────────────────+
| 阶段 2.3: 会话原地拉起与零断层闭环 (2 周)                                         |
| - 重构 CoworkModelPicker.tsx，下拉中不置灰本地模型，点击原地拉起 (提案 61:1953)  |
| - 废止并移除打断式 ModelStartedDialog.tsx                                         |
| - 输入岛下方集成显存预估与 28px 紧凑进度指示器                                    |
+───────────────────────────────────────────────────────────────────────────────────+
| 阶段 2.4: 统一模型中心 (Model Hub) 全面融合 (3 周)                                |
| - 按照 Figma 提案 60:2500 与 61:1715，合并本地推理与设置模型为统一视图           |
| - 打通硬件动态显存预警与模型防 OOM 协同调度                                       |
+───────────────────────────────────────────────────────────────────────────────────+
```

---

## 5. 前端开发者工程落地准则 (Engineering Landing Guidelines)

所有参与知远智能体前端开发的工程师必须严格遵守以下 **P0 级工程铁律**：

### 准则 1：外观与行为严格分离，严禁内联写死颜色
- **禁止**：在组件中使用裸 Hex（如 `bg-[#3D70E0]`）、裸 Tailwind 命名色（如 `text-blue-500`、`bg-gray-100`）或随意手写阴影。
- **要求**：必须使用语义 Token（如 `bg-surface-raised`、`border-border`、`text-foreground`）或组件 Recipe（`src/renderer/theme/components/`）。
- **改外观流程**：改外观先查已有 Recipe；新语义先在 `tokens/contract.ts` 扩充并在全部主题中成套补齐，然后跑 `bun run theme:generate`。

### 准则 2：32px 统一控件规格与无障碍基准
- **禁止**：为节省空间随意缩减按钮至 14px~20px，禁止在列表行内放置只有 hover 才能看见的裸 `div onClick` 或无标注 unicode 符号。
- **要求**：所有可点击控件默认高度 32px、圆角 8px、图标 16px；次级紧凑控件为 28px；行级操作区域必须满足无障碍点击热区。

### 准则 3：弹窗舒展度必须对照 Codex 标杆
- **基准参考**：`src/renderer/components/agentSidebar/EditProjectDialog.tsx`。
- **规格红线**：
  - 表单弹窗最小宽度 448px (`sm:max-w-md`)，带复杂列表时为 512px (`max-w-lg`)；
  - 字段纵向间距严格为 16px，文字 ≥14px；
  - 空间不足时**加宽容器**，严禁通过缩字号或压缩控件间距硬塞。

### 准则 4：全局 Toast 必须走统一分发渠道
- **禁止**：直接 `window.dispatchEvent(new CustomEvent('app:showToast'))`。
- **要求**：必须通过 `showAppToast` 或 `showAppError`（`src/renderer/services/toastNotification.ts`）派发，CI 的 `check-app-show-toast-dispatch.mjs` 会强制阻断违规提交。

### 准则 5：流式链路严禁拼全文与二次节流
- **架构守护**：
  - 严禁在发送端拼接全文后 diff；
  - 严禁在主进程 IPC 推送时增加二次节流；
  - 严禁违规向 Redux 高频写入全量快照，必须遵守 16ms coalescer 单点合并与 rAF 批处理规则。
