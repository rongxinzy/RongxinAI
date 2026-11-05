# 知远智能体 (ZhiYuan Agent) · UX 深度审计与体验协同重构决策报告

> **报告版本**：v4.0.0 (Quiet Studio)  
> **审计日期**：2026-11-05  
> **执行角色**：Teamwork Worker (Implementer, QA, Specialist)  
> **规范依据**：`DESIGN.md` (v4.0 Quiet Studio), `AGENTS.md` (Frontend Design Rules P0)  
> **目标 Figma 项目**：`l1IdC96sLjXx5CfPwcG4pQ`（[知远智能体 — 产品现状与设计重构](https://www.figma.com/design/l1IdC96sLjXx5CfPwcG4pQ/知远智能体-—-产品现状与设计重构?node-id=0-1&p=f&t=BUtatH2p9uYgPDiH-0)）

---

## 目录

1. [执行摘要与审计背景](#1-执行摘要与审计背景)
2. [本地推理与模型配置深度审计：四大割裂面板](#2-本地推理与模型配置深度审计四大割裂面板)
3. [代码库中发现的 5 大关键体验与规范违规详查](#3-代码库中发现的-5-大关键体验与规范违规详查)
4. [统一模型中心 (Unified Model Hub) 目标架构方案](#4-统一模型中心-unified-model-hub-目标架构方案)
5. [重构前后决策对比矩阵 (Before vs After Matrix)](#5-重构前后决策对比矩阵-before-vs-after-matrix)
6. [Figma 目标提案与工程落地映射](#6-figma-目标提案与工程落地映射)
7. [结论与下一步工程推进](#7-结论与下一步工程推进)

---

## 1. 执行摘要与审计背景

知远智能体 (ZhiYuan Agent) 定位于本地优先的高性能 AI Agent 桌面系统，核心能力包括自主多步执行（Cowork）、本地量化模型推理（基于 llama.cpp）与第三方云端 API 统一调度（基于 Magpie 网关）。

在经历多次功能迭代后，底层引擎（CPython 独立环境、llama.cpp 运行时管理、16ms 流式增量推送）已非常稳固，但在用户交互与界面体验层面积累了显著的摩擦与技术割裂。特别是在**本地推理与模型配置**链路中，功能被分散在 4 个相互孤立的面板，导致用户在下载、配置、启动与使用模型时频繁遭遇操作断层、强行弹窗驱赶和晦涩的技术黑话。

同时，对照仓库现行设计规范 **DESIGN.md (v4.0 Quiet Studio)** 与 **AGENTS.md**，代码库中仍残留少量违规的微动效（如呼吸动画）及超小可点击区域（12-14px 按钮），严重违反了「一屏一个重心」、「32px 统一控件规格」及「安静的动效」等 P0 门禁级设计原则。

本报告对上述 UX 痛点与违规代码进行彻底审计，提出端到端协同的**统一模型中心 (Unified Model Hub)** 架构方案，并给出详尽的重构前后决策矩阵与工程落地指引。

---

## 2. 本地推理与模型配置深度审计：四大割裂面板

当前产品中，模型相关的功能分散在四个互不通气的交互表面中：

```
┌────────────────────────────────────────────────────────────────────────┐
│                        当前体系中的四大割裂面板                        │
├─────────────────────┬───────────────────┬──────────────────────────────┤
│ 面板 1: 模型市场     │ 面板 2: 本地推理  │ 面板 3: 设置-模型配置        │
│ (MarketplacePanel)  │ (ModelsPanel)     │ (ModelSettingsPanel)         │
│ - 搜索魔搭/HF GGUF  │ - 已下载本地 GGUF │ - 云端 API 渠道 (OpenAI 等)  │
│ - 硬件兼容性探测    │ - 启动/停止/检查  │ - 默认模型路由与参数偏好     │
├─────────────────────┴───────────────────┴──────────────────────────────┤
│ 面板 4: Cowork 输入岛模型选择器 (CoworkModelPicker)                    │
│ - 仅展示在线运行的模型；未启动的本地模型直接置灰，无法原地拉起         │
└────────────────────────────────────────────────────────────────────────┘
```

### 2.1 面板 1：模型市场 (`MarketplacePanel.tsx`)
- **路径**：`src/renderer/components/localInference/panels/MarketplacePanel.tsx`
- **定位**：供用户发现、检索并下载量化 GGUF 模型。
- **割裂表现**：
  1. **孤立的下载终态**：当用户经历漫长等待下载完 4~16GB 的模型后，市场界面仅展示一个静态的「已在库中」Badge。没有「立即启动」、「设为当前模型」或「开始会话」的直接行动点，用户必须手动切换到「本地模型」标签页，在长列表中重新翻找。
  2. **断层的网络错误处理**：当网络请求失败且本地无缓存模型时，界面将错误直接吞没，错误地呈现「未找到模型」空状态，误导用户认为是搜索关键词无效。

### 2.2 面板 2：本地模型管理与检查器 (`ModelsPanel.tsx`, `ModelInspectorSidebar.tsx`)
- **路径**：
  - `src/renderer/components/localInference/panels/ModelsPanel.tsx`
  - `src/renderer/components/localInference/components/ModelInspectorSidebar.tsx`
- **定位**：管理本地硬盘中的 GGUF 文件、启动/停止 `llama-server` 进程与调整推理参数。
- **割裂表现**：
  1. **打断流程的启动反馈**：用户点击「启动」后，系统弹窗强行提示「模型已启动，是否前往设置将其配置为默认模型？」，粗暴打断用户在当前界面的连续操作。
  2. **信息拥挤与文字截断**：右侧抽屉式模型检查器在 300px 宽度下，参数标签与取值采用左右并排排版，导致 `n_gpu_layers`、`context_length` 等长标签发生严重文字重叠与截断（提案 `26:1684` 对应此问题）。
  3. **违规呼吸动画**：模型运行状态使用了违规的 `BreathingDot` 2 秒循环脉冲动画。

### 2.3 面板 3：设置中心中的模型配置 (`ModelSettingsPanel.tsx`, `ProviderEditDialog.tsx`)
- **路径**：
  - `src/renderer/components/settings/model/ModelSettingsPanel.tsx`
  - `src/renderer/components/settings/model/ProviderEditDialog.tsx`
- **定位**：管理全局默认模型、云端 API 供应商（Magpie 网关）与路由偏好。
- **割裂表现**：
  1. **认知错位与管理黑盒**：在「渠道与模型」列表中，本地启动的模型被标记为系统托管的 `zhiyuan-host-local-gpu` 渠道。用户在这里既不能调整本地启动参数，也不能在此处直接启动新的本地模型，只能作为只读项查看。
  2. **可访问性极差的超小按钮**：在供应商模型管理弹窗中，模型的「设为主模型」、「设为回退」与「删除」按钮命中区仅 14px，采用晦涩的 `★` 与 `↻` 字符，隐藏在 hover opacity 之后，严重违反 Quiet Studio 与 WCAG 无障碍规范。

### 2.4 面板 4：Cowork 输入岛模型选择器 (`CoworkModelPicker.tsx`)
- **路径**：`src/renderer/components/cowork/CoworkModelPicker.tsx`
- **定位**：会话首页与执行中用于切换推理模型的下拉控件。
- **割裂表现**：
  1. **置灰死胡同**：当本地未启动模型时，下拉列表中的「使用本地模型」项直接变为 `disabled` 状态，副标题提示「本地模型未就绪」。用户无法在此点击启动，必须离开当前工作区，经由侧边栏跳转至「本地推理」，启动后再返回，操作链路极为繁琐。

---

## 3. 代码库中发现的 5 大关键体验与规范违规详查

在代码走查与工程审计中，确认并定位了 5 个具体的规范违规与交互缺陷：

### 违规 1：`ModelsPanel.tsx:563` —— 禁用级 BreathingDot 2 秒呼吸动画
- **文件代码定位**：`src/renderer/components/localInference/panels/ModelsPanel.tsx:561-570`
- **原始代码**：
  ```tsx
  {isRunning ? (
    <span className="pointer-events-none absolute right-3.5 top-3.5 z-10">
      <BreathingDot
        color="var(--zy-success)"
        duration={2}
        label={i18nService.t('localInferenceStatus_running')}
        size={8}
      />
    </span>
  ) : null}
  ```
- **违规性质**：**P0 级设计规范违规**。
- **规范条款**：
  - `AGENTS.md`「前端设计规则」明确要求：「禁止擅自新增色系...毛玻璃、渐变按钮、装饰光晕、悬停上浮/缩放、呼吸动画、嵌套卡片、Hero...」
  - `DESIGN.md` §七「动效与转场」明确要求：「严禁呼吸动画 (Breathing/Pulse)，保持界面沉静」。
- **UX 影响**：不间断的 2 秒微光呼吸在用户视线余光中制造无意义的视觉骚扰，破坏 Quiet Studio 的工具沉浸感。
- **整改方案**：废除 `BreathingDot`，替换为静态 6px 纯色圆点或带背景的中性徽章（Badge），如 `● 运行中`。

---

### 违规 2：`ProviderEditDialog.tsx:664-694` —— 14px 微小按钮与晦涩符号
- **文件代码定位**：`src/renderer/components/settings/model/ProviderEditDialog.tsx:664-694`
- **原始代码**：
  ```tsx
  <div className="ml-1 flex items-center gap-0.5 opacity-60 group-hover:opacity-100">
    {!isPrimary && (
      <button
        type="button"
        onClick={() => handleSetPrimary(modelId)}
        title={i18nService.t('magpieModelSetAsPrimary')}
        className="cursor-pointer rounded p-0.5 hover:bg-muted"
      >
        ★
      </button>
    )}
    <button
      type="button"
      onClick={() => handleToggleFallback(modelId)}
      title={i18nService.t('magpieModelSetAsFallback')}
      className={`cursor-pointer rounded p-0.5 hover:bg-muted ${
        isFallback ? 'text-primary' : ''
      }`}
    >
      ↻
    </button>
    <button
      type="button"
      onClick={() => handleRemoveModel(modelId)}
      title={i18nService.t('magpieModelRemove')}
      className="cursor-pointer rounded p-0.5 hover:bg-destructive/20 hover:text-destructive"
    >
      <X className="size-3" />
    </button>
  </div>
  ```
- **违规性质**：**规范违规与严重可访问性缺陷**。
- **规范条款**：
  - `DESIGN.md` §二「组件规格」：「统一规格 32px，行、按钮、芯片统一 32px 高、8px 圆角，文字起点对齐」。
  - `DESIGN.md`「Button 使用纪律」：「行级可点区域不用裸 div / bare button onClick」。
- **UX 影响**：
  1. 按钮命中区尺寸仅 `p-0.5`（实际点击热区不到 14×14px），极易发生误点或点偏；
  2. 依赖 `opacity-60 group-hover:opacity-100`，触控屏或键盘导航无法操作；
  3. 使用非标 unicode 符号 `★` 和 `↻`，对屏幕朗读器极其不友好。
- **整改方案**：彻底重构为行式表格（对齐 Figma 提案 `34:934`），将操作提升为标准 32px / 28px 次级按钮，带文字标识「设为主要」、「设为备选」与「移除」。

---

### 违规 3：`MarketplacePanel.tsx:321-344` —— 搜索异常吞没与假空状态 Bug
- **文件代码定位**：`src/renderer/components/localInference/panels/MarketplacePanel.tsx:321-344`
- **原始代码**：
  ```tsx
  {marketplaceError && models.length > 0 ? (
    <Alert>
      <AlertTitle>
        {marketplaceError.startsWith('CATALOG_ERROR:')
          ? i18nService.t('marketplaceSearchStatusCatalogUnavailable')
          : i18nService.t('marketplaceSearchStatusWarning')}
      </AlertTitle>
      <AlertDescription>
        {marketplaceError.replace(/^(?:CATALOG_ERROR|AUTH_ERROR):\s*/, '')}
      </AlertDescription>
    </Alert>
  ) : null}

  {marketplaceLoading && models.length === 0 ? (
    <MarketplaceGridSkeleton pageSize={MARKETPLACE_PAGE_SIZE} />
  ) : !hasSearched ? null : visibleModels.length === 0 ? (
    <EmptyState
      className="flex-1"
      title={i18nService.t('marketplaceNoModels')}
      action={...}
    />
  ) : ...}
  ```
- **违规性质**：**逻辑缺陷与错误体验灾难**。
- **缺陷剖析**：
  - 当发生网络中断、DNS 解析失败或 ModelScope 镜像不可达时，若本地 `models.length === 0`，条件 `marketplaceError && models.length > 0` 直接判定为 `false`，导致错误警示组件 `Alert` **完全不渲染**！
  - 随后代码直接落入 `visibleModels.length === 0` 分支，渲染了轻量级的 `<EmptyState title="未找到模型" />`。
- **UX 影响**：用户误以为是自己输入的搜索词在整个模型生态中不存在，完全不知道是底层网络错误，导致反复修改无辜的关键词，造成极大挫败感。
- **整改方案**：采纳 Figma 提案 `25:1335`，将 `marketplaceError` 作为一等条件处理。只要有错误且无本地可用数据，立即展示带具体错误原因的诊断面板，并提供 32px 中性「重试连接」主操作。

---

### 违规 4：`ModelStartedDialog.tsx:43-67` —— 强行阻断式弹窗重定向
- **文件代码定位**：`src/renderer/components/localInference/components/ModelStartedDialog.tsx:43-67`
- **原始代码**：
  ```tsx
  <DialogHeader className="gap-1">
    <DialogTitle className="text-center">
      {i18nService.t('localInferenceModelStartedTitle')}
    </DialogTitle>
    <DialogDescription>
      {i18nService
        .t('localInferenceModelStartedDescription')
        .replace('{name}', startedModelName ?? '')}
    </DialogDescription>
  </DialogHeader>
  <DialogFooter className="theme-control-sizing-18 border-t-0">
    <Button
      type="button"
      variant="outline"
      onClick={onClose}
    >
      {i18nService.t('localInferenceConfigureLater')}
    </Button>
    <Button
      type="button"
      variant="outline"
      onClick={() => {
        onClose();
        onOpenModelSettings();
      }}
    >
      {i18nService.t('localInferenceOpenModelSettings')}
    </Button>
  </DialogFooter>
  ```
- **违规性质**：**打断式交互与跨域割裂**。
- **UX 影响**：模型启动就绪本是正常操作结果，界面却强行弹出一个阻断式模态对话框，诱导用户离开当前正在操作的本地推理界面，跳转去设置中心，强行打断用户的注意力链路。
- **整改方案**：彻底**废止并移除该弹窗**。模型启动就绪后，原位将按钮变为「运行中」，并在顶部状态面板给出静默通知，同时提供原地「设为默认会话模型」的单选开关或内联胶囊，实现零跳转。

---

### 违规 5：`CoworkModelPicker.tsx:94-110` —— 本地模型未就绪时置灰无一键拉起
- **文件代码定位**：`src/renderer/components/cowork/CoworkModelPicker.tsx:94-110`
- **原始代码**：
  ```tsx
  <CommandGroup heading={i18nService.t('coworkLocalModelsHeading')}>
    <CommandItem
      value="use-ready-local-model"
      variant="selector"
      disabled={!readyLocalModel}
      onSelect={() => {
        if (!readyLocalModel) return;
        onSelect(readyLocalModel);
        handleOpenChange(false);
      }}
    >
      <SelectorOptionContent
        icon={<Cpu className="size-4" />}
        title={i18nService.t('coworkUseLocalModel')}
        description={readyLocalModel?.name ?? i18nService.t('coworkLocalModelNotReady')}
      />
    </CommandItem>
  </CommandGroup>
  ```
- **违规性质**：**工作区死胡同与交互摩擦**。
- **UX 影响**：用户在输入指令准备执行任务时，若想使用本地已下载的 DeepSeek 或 Qwen 模型，却发现该选项是灰色的。系统没有提供任何辅助操作，迫使用户放弃当前输入的指令，跳出任务去启动模型。
- **整改方案**：在下拉列表中正常展示已下载的本地模型。当用户选中未加载的本地模型时，**直接在 Cowork 原地触发后台加载**，并在输入岛下方展示中性平滑的进度指示（如「正在分配显存 5.2GB...」带「取消」按钮），加载完成后自动选中，实现无缝衔接。

---

## 4. 统一模型中心 (Unified Model Hub) 目标架构方案

针对四大面板割裂，提出**统一模型中心 (Model Hub)** 架构方案。将分散在「本地推理」与「设置-模型」中的能力整合成一个兼顾全局模型调度与本地硬件协同的单一入口。

### 4.1 核心架构与功能分层

```
+---------------------------------------------------------------------------------------------------+
| PageHeader: "模型中心" (统一入口，置于侧栏主导航 / 快捷键 Ctrl+M)                                 |
+---------------------------------------------------------------------------------------------------+
| 标签页 (PageTabs):                                                                                |
| [1. 我的模型与服务 (已装载/已配置)]   [2. 模型市场与发现 (下载/导入)]   [3. 引擎与高级偏好 (参数)]|
+---------------------------------------------------------------------------------------------------+
| [顶级硬件感知面板 - 12px 圆角抬升面, 面分区]                                                      |
| CPU: Apple M3 Max (16 核) | 统一内存: 64GB (已用 18.2GB) | 当前推理后端: Metal (硬件加速)          |
| 默认会话模型: Qwen 2.5 7B (本地 Metal) [更换]  |  运行中模型: 1 个 (显存占用 5.8GB / 32k 上下文)   |
+---------------------------------------------------------------------------------------------------+
|                                                                                                   |
| [统一模型列表 - 标准 32px 规范行式列表，无呼吸动效，无卡片上浮抖动]                               |
|                                                                                                   |
| ┌─ 本地量化模型 (GGUF) ────────────────────────────────────────────────────────────────────────┐  |
| │ ● Qwen 2.5 7B Instruct      Q4_K_M · 4.8GB · 上下文 32k    [当前默认]  [查看参数]  [停止]  [···] │  |
| │ ○ DeepSeek R1 8B            Q4_K_M · 5.1GB · 上下文 16k    [设为默认]  [一键启动]  [参数]  [···] │  |
| │ ○ Llama 3.3 70B Instruct    Q4_K_M · 42.0GB (超出当前内存)  [显存不足预警]         [详情]  [···] │  |
| └──────────────────────────────────────────────────────────────────────────────────────────────┘  |
|                                                                                                   |
| ┌─ 云端 API 供应商 ────────────────────────────────────────────────────────────────────────────┐  |
| │ ○ DeepSeek V3 (官方)        云端 API · 延迟 120ms · 128k   [设为默认]  [测试连通]  [编辑]  [···] │  |
| │ ○ Claude 3.5 Sonnet         Anthropic · 延迟 450ms · 200k  [设为默认]  [测试连通]  [编辑]  [···] │  |
| └──────────────────────────────────────────────────────────────────────────────────────────────┘  |
|                                                                                                   |
+---------------------------------------------------------------------------------------------------+
```

### 4.2 核心机制设计

1. **Magpie 网关与 llama.cpp 双向数据总线联动**：
   - 当本地模型启动时，主进程通过 `onModelBindingsChanged` 将本地运行的实例无缝注册进 Magpie 的 `zhiyuan-host-local-gpu` 虚拟渠道；
   - 前端全局通过单一 Redux 视图或 Hook（`useUnifiedModels()`）获取所有可用模型，消除两套数据源的不一致。
2. **硬件水位与防 OOM 冲突预测机制**：
   - 在启动任何本地模型前，系统读取 GGUF Header 中的张量大小与用户设定的 `contextSize`，结合当前可用 VRAM 预判；
   - 若剩余显存不足以容纳，但在卸载当前运行模型后可以运行，系统弹出行内操作提示：「显存受限：启动此模型将自动释放正在运行的 Qwen 2.5 7B，是否继续？」，避免黑屏崩溃或底层报错。
3. **Cowork 原地唤醒与无缝绑定**：
   - `CoworkModelPicker` 不再置灰任何已在硬盘上的本地模型；
   - 用户选中即在输入岛展开 28px 紧凑进度指示器，完成后自动设为当前会话模型，无需任何额外确认。

---

## 5. 重构前后决策对比矩阵 (Before vs After Matrix)

下表对本次审计发现的所有体验与工程痛点，进行详细的重构前后对比梳理：

| 痛点编号 | 交互痛点描述 | 现状实现 (Before) | 破坏后果与 UX 故障模式 | 重构决策 (After) | Quiet Studio 对齐规则 | Figma 提案映射节点 |
|:---|:---|:---|:---|:---|:---|:---|
| **FP-01** | **本地模型运行状态呼吸动画** | `ModelsPanel.tsx:563`<br>使用 `BreathingDot` 2 秒循环缩放动画 | 视线余光受到无意义动态骚扰，视觉喧宾夺主，破坏沉静感 | 移除呼吸动效，替换为 6px 纯色圆点 + 中性 `Badge`（静态展示） | Quiet Motion (静止界面无循环动画，动效仅用于 120ms 交互过渡) | `24:301`, `60:2500` |
| **FP-02** | **服务商模型管理 14px 细碎按钮** | `ProviderEditDialog.tsx:664`<br>密集 Chip 胶囊内嵌 14px 裸按钮 (`★`, `↻`, `X`) | 命中区极小易点偏，必须 hover 才能看见，无键盘焦点与无障碍支持 | 重构为标准行式表格，操作按钮提升至 32px/28px，带清晰文本标签 | 统一规格 32px，禁止行内裸按钮与微型命中区 | `34:934`, `61:1715` |
| **FP-03** | **模型市场搜索网络错误被吞没** | `MarketplacePanel.tsx:321`<br>逻辑判定 `models.length > 0` 才显示错误警示 | 无本地缓存时网络中断，错误被吞没，用户看到假「未找到模型」空状态 | 分流处理：网络错误显示显式诊断面板与重试按钮；仅真正无匹配时展示空状态 | 次要信息明确可恢复，不谎报或掩盖底层错误 | `25:1335` |
| **FP-04** | **启动本地模型后强行弹窗驱赶** | `ModelStartedDialog.tsx`<br>模型启动后弹出模态框要求跳转到设置 | 打断用户在当前界面的连续操作，产生跨页面迷失感 | 废除该弹窗，原位切换按钮为「运行中」，并在顶部状态面板给出静默通知 | 零断层无感操作，不制造不必要的模态阻断 | `60:2500` |
| **FP-05** | **Cowork 无法在会话内启动本地模型** | `CoworkModelPicker.tsx:97`<br>未就绪时置灰 `disabled={!readyLocalModel}` | 用户想用本地模型必须离开当前会话，跳至侧栏启动后再切回 | 下拉列表不置灰本地模型，选中后在输入岛原地拉起并展示平滑加载 | 一屏一个重心，能力原地触达，不跨页面搬迁操作 | `61:1953` |
| **FP-06** | **模型检查器参数与数值严重截断** | `ModelInspectorSidebar.tsx:273`<br>窄抽屉内参数标签与数值左右并排 | 在 300px 宽度下标签被挤压重叠，如 `n_gpu_layers` 无法完整读取 | 采纳分行排版：标签在上、数值在下，右侧放置滑动条与步进器 | 文本层级清晰，不发生水平截断 | `26:1684` |
| **FP-07** | **本地模型卡片悬浮上浮与拖拽抖动** | `ModelsPanel.tsx`<br>卡片设置 `hover:z-20`、阴影膨胀与拖拽抓手 | 鼠标划过卡片剧烈上浮，容易产生眩晕感与误触拖拽 | 采纳行式列表替代卡片网格，hover 仅切换微弱背景表面，按压位移仅 1px | 废除悬停上浮与卡片嵌套，用面分区 | `60:2500` |
| **FP-08** | **硬件资源与显存竞争缺乏预警** | `llamacppManager`<br>显存超额时仅抛出底层的 OOM 异常报错 | 用户启动模型后等待数十秒，最终只收到一个冷冰冰的错误 Toast | 启动前计算权重与上下文显存水位，提前提示释放旧模型或降级上下文 | 确定性反馈与故障自愈引导 | `24:300`, `60:2500` |

---

## 6. Figma 目标提案与工程落地映射

为确保重构方案可精确在 Figma 项目与前端工程之间建立双向映射，所有决策均对应到目标 Figma 项目 `l1IdC96sLjXx5CfPwcG4pQ` 中的具体画板与节点：

```
+---------------------------------------------------------------------------------------------------+
| Figma 页面与节点映射关系                                                                          |
+---------------------------------------------------------------------------------------------------+
| 1. 基础组件库 (Page 01 · 基础组件 - 4:33)                                                         |
|    - 32px 标准按钮矩阵: 4:76 (Primary, Secondary, Outline, Ghost, Destructive)                    |
|    - 32px 侧栏导航行: 4:43                                                                        |
|    - 32px 胶囊与芯片: 6:124                                                                       |
|    - 36×20px 开关规范: 9:99                                                                       |
+---------------------------------------------------------------------------------------------------+
| 2. 本地推理与模型中心重构 (Page 07 · 本地推理 - 24:300)                                           |
|    - 现状画板对照: 24:301 (深色网格), 24:447 (浅色网格)                                           |
|    - 核心重构提案: 60:2500 ("提案 · 本地模型 / 运行状态与操作 · 浅色")                            |
|      - 行式列表取代卡片网格                                                                       |
|      - 32px 标准操作按钮 (启动/停止/详情)                                                        |
|      - 移除 BreathingDot，采用静态纯色语义指示点                                                  |
+---------------------------------------------------------------------------------------------------+
| 3. 体验审查与缺陷修复提案 (Page 90 · 体验审查 - 10:1047)                                          |
|    - 搜索错误状态修复: 25:1335 ("提案 · 模型市场搜索失败")                                         |
|    - 检查器分行排版修复: 26:1684 ("提案 · 模型检查器标签完整显示")                                 |
|    - 供应商模型管理行式列表: 34:934 ("提案 · 渠道模型行式列表")                                    |
|    - 设置中心模型配置重构: 61:1715 ("体验重构提案 · 模型配置 · 浅色")                             |
|    - Cowork 原地更换默认模型: 61:1953 ("体验重构提案 · 更换默认模型 · 浅色")                      |
+---------------------------------------------------------------------------------------------------+
```

---

## 7. 结论与下一步工程推进

本次 UX 审计深入排查了知远智能体在本地推理与模型配置全链路上的结构性弊端，锁定了以 `ModelsPanel.tsx:563` 为代表的 5 处严重规范违规与体验断层。

提出的重构方案不仅全面满足 **Quiet Studio v4.0** 的全部硬性原则，更从系统架构层面消除了四大割裂面板的认知负荷，建立了清晰一致的**统一模型中心**。

### 推进建议路径：
1. **阶段 1（零风险清理）**：立即在代码中移除 `ModelsPanel.tsx` 的 `BreathingDot` 呼吸动画，修复 `MarketplacePanel.tsx` 错误状态吞没问题；
2. **阶段 2（组件规范化）**：按照 Figma 提案 `34:934` 重构 `ProviderEditDialog.tsx` 模型列表，将 14px 细碎按钮升级为标准 32px 行式表格；
3. **阶段 3（闭环体验升级）**：重构 `CoworkModelPicker.tsx`，允许在下拉中选中未加载本地模型并原地平滑启动，彻底废弃阻断式的 `ModelStartedDialog.tsx`；
4. **阶段 4（架构融合）**：在中期规划中将「本地推理」与「设置-模型」统一收归至独立的「模型中心」主视图。
