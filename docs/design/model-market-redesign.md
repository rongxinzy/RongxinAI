# 模型市场与本地模型管理 — 重设计规格

> **版本**：2026-10-16-draft  
> **范围**：仅设计交付（`docs/design/` + 静态 HTML 稿），不含应用实现。  
> **设计系统**：沿用 [DESIGN.md](../DESIGN.md) Zenith v3.0（Inter、8px 栅格、玻璃态卡片、蓝紫渐变主色）。  
> **关联能力（本分支）**：`ggufKvCacheEstimate.ts`、`modelMemoryEstimate.ts`、`kvCacheTypes.ts`、工作模式上下文守卫、llama.cpp 后端 lite/cpu/cuda 策略。

---

## 0. 现状问题清单（代码走读结论）

### 0.1 信息架构与导航

| 问题 | 证据 / 影响 |
| --- | --- |
| **市场与库混在同一「本地推理」页内 Tab**，认知负担高 | `LocalInferenceView` 仅 `models` / `marketplace` 两 Tab；运行时安装、网关、内存设置散落在 PageHeader 菜单与多个 Dialog，无统一「推理控制台」心智。 |
| **无独立模型详情路由/页面**，详情藏在卡片内 Popover | `MarketplaceModelDetails` 为 `Info` 图标 + Popover，无法承载量化对比、显存分解、双卡策略等深度信息。 |
| **搜索驱动首屏**，`hasSearched` 为 false 时不展示目录 | `MarketplacePanel` 在未搜索前为空白，精选/推荐无法「开箱即见」，违背「市场首页」预期。 |
| **任务分类维度偏少且与未来能力不对齐** | `MarketplaceTaskFilter` 含 chat/reasoning/code/vision/embedding，无 ASR/TTS/视频/OCR 独立入口；embedding 在 UI Tab 中未露出。 |
| **device 档位仅 base/pro/other** | `MarketplaceDeviceProfile` 与目录 `deviceFit` 粗粒度，无法表达「双 4060M 8GB」「双 4090M 16GB」等产品典型档。 |

### 0.2 交互与任务流

| 问题 | 证据 / 影响 |
| --- | --- |
| **适配结论不可解释** | 卡片仅展示 fit 图标 + 标签；`fit.reason` 与星级原因在 Popover 内，用户看不到 **权重 / KV / 上下文 / 双卡** 分解。 |
| **量化选择挤在卡片 Footer Select** | `MarketplaceModelCardView` 下拉最高 `max-h-40`，多分片 GGUF 难浏览；无「推荐量化」与「本机流畅度」联动高亮。 |
| **下载源不可选** | 后端已有 ModelScope ↔ hf-mirror URL 互转（`modelDownloadUrls.ts`），UI 下载侧栏无源切换与镜像说明。 |
| **下载与安装进度与详情分离** | `MarketplaceDownloadSidebar` 仅当前任务；无队列、断点续传说明、校验阶段（SHA256）的可视化叙事。 |
| **本地模型管理偏「卡片网格 + 加载按钮」** | `ModelsPanel` 重操作轻观测：缺 **运行中显存曲线、并发槽位、默认工作模式上下文** 的一屏总览。 |
| **Inspector 能力存在但入口深** | `ModelInspectorSidebar` 含上下文/KV 投影（`modelInspectorViewModel`），需从模型卡片打开，与市场/install 流未打通。 |
| **lite 版无专门引导** | 无本地推理时仍展示市场 Tab，与「安装 CUDA/CPU 运行时」路径耦合在 `RuntimeInstallCard` Dialog 内。 |

### 0.3 技术深度（产品表达层）

| 问题 | 证据 / 影响 |
| --- | --- |
| **目录侧 deviceFit 过粗** | 用户反馈权重×1.3 估显存；客户端虽有 `estimateLlamaCppModelMemory`，UI 未展示 KV cache 量化（cache_type_k/v）与 GGUF 元数据置信度。 |
| **双 GPU 未进入用户叙事** | `MarketplaceHardwareProfile.isDualGpu` 与 `llamacppModelGpuPlacement` 存在，市场 UI 仅显示 GPU 数量与总显存字符串。 |
| **tokens/s 缺失** | 无「预估区间 + 实测校准」展示位；不利于对比量化档与硬件档。 |
| **工作模式上下文守卫不可见** | `llamacppWorkModeContextGuard` 在 Agent 选模型时提示，本地推理页未前置「Work 模式建议 ≥32K」等约束。 |
| **能力扩展点未预留** | mmproj、语音、视频生成等无统一 **Capability Rail**（图标 + 依赖说明 + 最低显存档）。 |

### 0.4 视觉与一致性

| 问题 | 证据 / 影响 |
| --- | --- |
| **市场卡片信息密度失衡** | 标题/发布者/标签/适配/量化/操作挤在一层 `theme-market-card`，技术标签与营销式「星级」并存，显乱。 |
| **硬件摘要为单行小字** | GPU/内存挤在筛选条右侧，非「本机推理档案」组件，难以建立信任。 |
| **本地模型 Card 使用 shadcn Card 默认样式** | 与 DESIGN.md 范例的「留白分层、弱卡片化」相比，侧栏/列表仍偏「嵌套卡片墙」。 |
| **错误/空态语义分散** | 市场空结果、目录不可用、CUDA 需 NVIDIA 等文案分散在 Alert/Toast/Empty，无统一插图与下一步 CTA 规范。 |

---

## 1. 设计目标与原则

1. **先读懂本机，再推荐模型**：首页顶部固定「本机推理档案」（硬件、后端版本、空闲显存、推荐工作模式上下文）。
2. **可解释的流畅度**：任何「能跑/不能跑」必须展开为 **权重显存 + KV cache + 上下文 + 双卡切分 + 余量**；tokens/s 给区间并标注置信度。
3. **任务优先，能力可扩展**：市场按 **任务/能力** 分区，预留 OCR/VLM、ASR/TTS、视频（16GB 档）栏目。
4. **下载路径国情化**：默认 ModelScope，可选 hf-mirror；展示断点续传、校验、磁盘路径。
5. **管理页像「控制台」**：已装模型 = 资产清单 + 运行态 + 参数预设 + 一键诊断。
6. **视觉**：Zenith 玻璃态 + 紧凑桌面密度；技术数据用 **等宽数字列 + 横向堆叠条**，避免 Popover 藏关键信息。

---

## 2. 信息架构（IA）

```
本地推理（PageHeader 标题不变）
├── 控制台总览（新，可选默认 Tab 或顶栏摘要条）
│   ├── 服务状态 / 后端版本（lite | cpu | cuda b9244）
│   ├── GPU × N / 显存占用条
│   └── 快捷：诊断 · 运行时设置 · 模型库路径
├── 模型市场（重设计）
│   ├── 首页
│   │   ├── 本机推理档案
│   │   ├── 能力分区（精选轮播 / 网格）
│   │   ├── 「为本机推荐」列表（fit ≥ good）
│   │   └── 全库搜索 + 筛选
│   ├── 模型详情（全页或宽 Drawer，非 Popover）
│   │   ├── 概述 / 许可 / 运行时证据
│   │   ├── 量化版本表 + 流畅度估算
│   │   └── 下载 CTA
│   └── 下载面板（侧栏或步骤页）
│       ├── 源：ModelScope | hf-mirror
│       ├── 进度 / 断点 / SHA256
│       └── 完成后 → 加载向导
└── 本地模型（重设计）
    ├── 列表（表格式为主，卡片可选）
    ├── 模型检查器（沿用 Inspector，增强显存/live 指标）
    ├── 磁盘占用 / 并发 / 默认上下文
    └── 一键诊断（导出 JSON + 复制给支持）
```

**路由建议（实现阶段）**：`local-inference/market`、`local-inference/market/:modelId`、`local-inference/models`；当前 Tab 可映射为子路由。

---

## 3. 本机推理档案（全局组件）

**位置**：市场首页顶栏下方；本地模型页顶栏复用紧凑版。

| 字段 | 说明 |
| --- | --- |
| 后端 | `CPU + Vulkan/Metal` / `CUDA sm_89 (RTX 40)` / `Lite（未安装）` |
| GPU | 名称 × 数量；每卡 **总/已用/空闲** 显存条 |
| 内存 | 64 GB 总量 + 可用于 CPU offload 提示 |
| 工作模式 | Work 建议上下文（如 32K）与当前守卫状态 |
| 操作 | 「重新检测」「运行时设置」「诊断」 |

**双卡展示**：两块 GPU 迷你卡并列；模型详情中的切分策略标注 **Tensor Split / 按层**（与 `llamacppModelGpuPlacement` 对齐）。

---

## 4. 模型市场 — 首页

### 4.1 布局（1280×800 基准）

- **PageHeader**：标题「模型市场」；右侧：搜索框（全局）、「下载队列」图标（badge）。
- **本机推理档案**：高度约 72–88px（紧凑）。
- **能力分区（Capability Rail）** — `FluidTabs` 大号 + 横向滚动 chip：
  - 对话 · 推理 · 代码 · **视觉/OCR** · 向量 · **语音 ASR/TTS** · **视频生成（16GB+）**
  - 未支持的能力：chip 置灰 + 「即将推出」；点击仍可见预告说明（非空页）。
- **「为本机精选」**：横向卡片 carousel（3–4 张），每张含：适配徽章、推荐量化、预估 tokens/s 区间。
- **主列表**：双列网格（≥1280）/ 单列（窄窗）；卡片简化：
  - 行1：图标 + 名称 + 发布者
  - 行2：能力 tags（最多 3）
  - 行3：**流畅度条**（绿/黄/红）+ 推荐量化 + 主按钮「查看详情」
  - 移除：Popover 详情、卡片内量化下拉（下沉到详情页）

### 4.2 筛选

- 任务（同 Capability Rail 同步）
- **流畅度**：流畅 / 可玩 / 勉强 / 不支持（映射 fit status）
- 参数量、量化、许可证
- **不再默认「先点搜索才出列表」**：进入 Tab 即加载 SQLite 种子 + D1 精选页

### 4.3 空态 / 错误态

| 状态 | 文案方向 | CTA |
| --- | --- | --- |
| 目录不可用 | 说明 Cloudflare/D1 失败，可离线种子 | 重试 · 使用内置精选 |
| 筛选无结果 | 建议放宽流畅度 | 清除筛选 |
| Lite 未装运行时 | 不隐藏市场，顶部 Banner | 安装 CPU/CUDA 运行时 |
| 无 NVIDIA 但选 CUDA 模型 | 黄色 Alert | 切换 CPU 版后端 |

静态稿见：`mockups/marketplace-home-*.html`、`mockups/empty-states-*.html`。

---

## 5. 模型详情页

### 5.1 结构

1. **Hero**：名称、参数量、架构、许可、星级（可选折叠「为何推荐」）。
2. **本机流畅度（核心）**
   - 总评：流畅 / 需降上下文 / 不支持
   - **显存预算堆叠条**（水平 100% = 可用 VRAM）：
     - 段1：权重（GPU 驻留比例，可拖 gpu-layers 预设：全 GPU / 混合 / CPU）
     - 段2：KV cache（随上下文滑块 4K–128K 变化，读 `estimateKvBytesPerTokenFromGgufShape`）
     - 段3：运行时缓冲（~3% + 固定底）
   - **数字表**：VRAM 估算 / 系统内存 / 推荐上下文 / 双卡切分说明
   - **tokens/s 区间**：如「18–28 tok/s（Q4_K_M，双 4060 Ti 16GB，置信度 B）」— 目录 benchmark + 实测占位
3. **量化版本表**（默认 sort：推荐 > 体积）

| 量化 | 文件大小 | 本机 VRAM | 流畅度 | 操作 |
| --- | --- | --- | --- | --- |
| Q4_K_M ★ | 5.1 GB | 6.2 GB | 流畅 | 下载 |
| Q5_K_M | 6.0 GB | … | 可玩 | 下载 |

4. **运行时证据**：GGUF 校验、chat template、tool calling、mmproj 行
5. **Sticky Footer**：主按钮「下载并安装」· 次按钮「仅加入愿望单」（可选）

### 5.2 上下文交互

- 滑块联动 KV 段与 `recommendedContext`
- 超出工作模式守卫时显示 inline warning（链接到 Work 模式说明）

静态稿：`mockups/model-detail-*.html`。

---

## 6. 下载流程

### 6.1 源选择

- 默认 **ModelScope**（国情用户）
- 备选 **hf-mirror**（说明：无需访问 huggingface.co）
- 记住上次选择（kv）

### 6.2 步骤 UI

1. 确认文件列表（多分片展开）
2. 下载（断点续传 — 文案 + 进度条 per file）
3. SHA256 校验（勾选动画）
4. 写入模型库路径展示
5. 「立即加载」→ 打开 Inspector 预设上下文

侧栏保留，但增加 **全屏步骤页** 模式（窄窗自动切换）。

静态稿：`mockups/download-*.html`。

---

## 7. 本地模型管理页

### 7.1 列表（推荐表格式）

| 模型 | 大小 | 状态 | 显存 | 上下文 | 操作 |
| --- | --- | --- | --- | --- | --- |
| Qwen3-8B Q4 | 5.1G | 运行中 | 6.8/16 GB | 32K | 卸载 · 设置 |

- **状态**：未加载 / 加载中 / 运行中（BreathingDot 保留）
- **批量**：磁盘占用合计、清理缓存、打开文件夹

### 7.2 检查器增强（Inspector）

- Tab：**概览 | 性能 | 日志**
- 概览：上下文、keep-alive、 residency
- 性能：实时 VRAM（若 IPC 可提供）、估算 vs 实测偏差
- 默认参数：temperature、并发 slot（llama-server flags 友好命名）

### 7.3 一键诊断

生成结构化报告：

- 硬件快照、驱动、后端 build
- 已装模型列表 + 路径
- 最近 launch log 摘要
- 网络：ModelScope/hf-mirror 探测
- 复制 / 导出 JSON

静态稿：`mockups/local-models-*.html`。

---

## 8. 估算与数据契约（实现指引）

### 8.1 流畅度引擎（客户端）

复用并暴露 UI：

```text
estimateLlamaCppModelMemory({
  modelSizeBytes,
  contextSize,
  cacheTypeK, cacheTypeV,
  kvBytesPerToken,  // from GGUF when available
  gpuWeightFraction // from placement policy
})
```

**双卡**：`totalVramMiB` 求和用于 fit ratio；详情页展示 **per-GPU 分配**（来自 `llamacppModelGpuPlacement`）。

### 8.2 目录增强（zhiyuanBackend / 种子 SQLite）

建议扩展 `CatalogModel`（设计层，非本 PR 实现）：

- `capabilities[]`：含 `asr` | `tts` | `video` | `ocr`
- `deviceFitProfiles[]`：`{ tier: 'dual-4060-8g' | 'dual-4090-16g' | ...; minVramMiB; notes }`
- `benchmarkTokensPerSec[]`：`{ quant, hardwareTier, p50, p90, source }`
- `ggufMeta`: layer/head 供 KV 精确估算

### 8.3 tokens/s 展示规则

- 有 benchmark → 显示区间 `[p50, p90]`，置信度 A/B
- 无 benchmark →  heuristic 区间 + 置信度 C + 「安装后实测」CTA
- 禁止伪造精确单值

---

## 9. 组件映射（实现时）

| 设计组件 | 现有 / 目标 |
| --- | --- |
| PageHeader | 已有 |
| FluidTabs / PageTabs | 能力分区、Inspector |
| 市场卡片 | 重构 `MarketplaceModelCardView` → 薄卡片 + 路由详情 |
| 流畅度堆叠条 | **新** `MemoryBudgetBar`（纯 layout + recipe） |
| 量化表 | **新** `QuantVariantTable` |
| 本机档案 | **新** `InferenceHardwareProfileBar` |
| 下载源 | 扩展 `MarketplaceDownloadSidebar` |
| 模型列表 | 重构 `ModelsPanel` 表格式 |
| Empty / Alert | 统一 `localInference` empty recipe |

---

## 10. 设计 Token（局部）

沿用 DESIGN.md；本模块补充：

| Token | 值 | 用途 |
| --- | --- | --- |
| `--inference-bar-weight` | `#3B82F6` / dark `#60A5FA` | 显存条·权重段 |
| `--inference-bar-kv` | `#8B5CF6` / `#A78BFA` | KV 段 |
| `--inference-bar-buffer` | `#94A3B8` | 缓冲段 |
| `--inference-bar-free` | `var(--zy-border)` | 剩余显存 |
| 数字列 | `font-mono 12px/18px` | 估算表 |
| 档案条高度 | 72px compact / 88px expanded | 本机档案 |
| 详情页最大宽 | 960px | 阅读型内容 |
| 表格行高 | 40px | 量化表、模型列表 |

**字号**：正文 13px；卡片标题 15px；页标题 20px（H1）。  
**间距**：卡片内 padding 20px；段间距 16px；表单弹窗仍遵守最小 448px 宽。

---

## 11. 无障碍与 i18n

- 流畅度不仅靠颜色：图标 + 文案（流畅/可玩/勉强）
- 所有估算附「如何计算」链接（打开解释 Drawer，非外链 HF）
- 用户可见字符串走 `t()`；技术单位 GB/MiB 与现有 `formatBytes` 一致

---

## 12. 静态稿索引

| 文件 | 说明 |
| --- | --- |
| `mockups/marketplace-home-light.html` | 市场首页 · 浅色 |
| `mockups/marketplace-home-dark.html` | 市场首页 · 深色 |
| `mockups/model-detail-light.html` | 模型详情 · 浅色 |
| `mockups/model-detail-dark.html` | 模型详情 · 深色 |
| `mockups/download-light.html` | 下载步骤 · 浅色 |
| `mockups/download-dark.html` | 下载步骤 · 深色 |
| `mockups/local-models-light.html` | 本地模型管理 · 浅色 |
| `mockups/local-models-dark.html` | 本地模型管理 · 深色 |
| `mockups/empty-states-light.html` | Lite/错误空态 · 浅色 |
| `mockups/empty-states-dark.html` | Lite/错误空态 · 深色 |

截图输出：`/opt/cursor/artifacts/model-market-redesign/*.png`。

---

## 13. 落地检查清单（实现 PR 时用）

- [ ] 进入市场即见精选，无需先搜索
- [ ] 详情页可解释显存分解与双卡
- [ ] 下载可选 ModelScope / hf-mirror
- [ ] 本地模型页展示运行显存与诊断
- [ ] lite / 无 GPU / 目录失败 空态齐全
- [ ] 明暗主题 recipe 完整
- [ ] 未在页面写局部颜色 bypass theme

---

## 14. 附录：典型硬件预设（产品档）

| 档位 ID | 配置 | 市场默认筛选 |
| --- | --- | --- |
| `dual-mobile-4060-8g` | 64GB + 2×RTX 4060M 8GB | 7B–14B Q4；32K 上下文需提示 KV |
| `dual-4090-16g` | 64GB + 2×4090M 16GB | 32B Q4/Q5；Work 32K 流畅 |
| `dual-4060ti-16g` | 64GB + 2×16GB 4060 Ti 级 | 中间档推荐 |

客户端检测到的硬件 **映射到最近档位**，用于 benchmark 与 copy 文案，而非仅 base/pro。
