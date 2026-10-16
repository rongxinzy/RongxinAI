# 模型市场与本地模型管理 — 重设计规格

> **版本**：2026-10-16-rev2（推理工程师把关修订）  
> **范围**：仅设计交付（`docs/design/` + 静态 HTML 稿），不含应用实现。  
> **设计系统**：沿用 [DESIGN.md](../DESIGN.md) Zenith v3.0；本模块视觉密度参考 **LM Studio / Ollama 桌面端**（紧凑列表、少大面积留白、主操作每屏 1 个强调色按钮即可）。  
> **实现可复用（不对用户暴露名词）**：客户端显存/KV 估算与 GPU 放置策略（`modelMemoryEstimate`、`llamacppModelGpuPlacement` 等）。

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
| **双 GPU 叙事错误风险** | 易误导为默认 tensor/layer split；正确策略是 **单卡能放下则不分卡**，第二卡留给并行第二模型。 |
| **tokens/s 缺失或随意** | 需基于显存带宽公式估算并标注「估算」，禁止拍脑袋区间。 |
| **技术术语直出 UI** | 内部模块名、守卫、探针等不应出现在默认视图。 |
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

1. **先读懂本机，再推荐模型**：顶部「本机档案」+ **GPU 分配视图**（哪张卡跑哪个模型、各占多少）。
2. **默认人话，详细折叠**：结论三件套 — **流畅 / 可用 / 不推荐** + 一句理由 + **预计速度（估算）**；技术分解仅在「详细」内。
3. **双卡策略（P0）**：单卡可放下 → `split-mode: none` + 指定 `main-gpu`；第二卡预留给 **并行** 的 embedding / OCR / ASR 或第二个对话实例；**仅当单卡显存不足** 才跨卡 layer split（并明确提示速度会受 PCIe 影响）。
4. **tokens/s**：按显存带宽公式计算，UI 一律带「估算」；安装后可写入实测校准。
5. **精选来自硬件档策展表**（SQLite 种子），示例族以 **Qwen3** 等当前主流为主，不用过时型号充精选。
6. **视觉**：紧凑列表 + 均衡信息密度；渐变主按钮仅保留每页 1 个主 CTA，其余 outline/ghost。

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
│   │   ├── 默认：结论 + 预计速度（估算）
│   │   ├── 「详细」：显存分解、GPU 放置、带宽公式说明
│   │   ├── 量化版本表
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
| 内存 | 64 GB 总量；**仅当存在 CPU offload 时** 显示 offload 占用，全 GPU 时写「未使用 CPU 卸载」 |
| 常用上下文 | 用户上次或推荐值（如 32K），不用内部模式名 |
| 操作 | 「重新检测」「运行时设置」「诊断」 |

### 3.1 GPU 分配视图（双卡 P0）

**本地模型页与市场详情「详细」区必含**，Ollama 式「哪张卡在跑什么」：

| GPU | 当前模型 | 占用 | 策略 |
| --- | --- | --- | --- |
| GPU 0 · RTX 4060 Ti 16GB | Qwen3-8B-Instruct Q4_K_M | 6.3 / 16 GB | 单卡完整加载（无跨卡切分） |
| GPU 1 · RTX 4060 Ti 16GB | Qwen3-Embedding-0.6B | 0.6 / 16 GB | 并行第二模型 |
| GPU 1 | （空闲） | 0.1 / 16 GB | 可再加载一个 7B 级模型 |

**放置规则（实现）**：

1. 若 `weights + KV(context) + buffer ≤ 单卡可用显存` → 整模上 **一张卡**，`split-mode none`，记录 `main-gpu`。
2. 若双卡且第二任务为 embedding/OCR/ASR 等 → **独立进程/实例** 绑 GPU1，不与主模型争用 PCIe split。
3. 若仅当步骤 1 失败 → **layer split** 跨卡，UI 结论降为「可用」并提示：「跨显卡切分，生成速度可能下降」。
4. **禁止**在步骤 1 成立时默认 tensor split（跨卡通信拖慢 decode）。

---

## 4. 模型市场 — 首页

### 4.1 布局（1280×800 基准）

- **PageHeader**：标题「模型市场」；右侧：搜索框（全局）、「下载队列」图标（badge）。
- **本机推理档案**：高度约 72–88px（紧凑）。
- **能力分区（Capability Rail）** — `FluidTabs` 大号 + 横向滚动 chip：
  - 对话 · 推理 · 代码 · **视觉/OCR** · 向量 · **语音 ASR/TTS** · **视频生成（16GB+）**
  - 未支持的能力：chip 置灰 + 「即将推出」；点击仍可见预告说明（非空页）。
- **「为本机精选」**：数据来自 **硬件档策展表**（见 §14），横向紧凑条（3–4 项），每项：结论徽章 + 一句理由 + `约 XX–YY tok/s（估算）` + 推荐量化。
- **主列表**：**高密度行列表**（LM Studio 风格，≥1280 可双列行块），每行：
  - 左：名称 + 参数量 · 发布者
  - 中：能力 tags（≤3）+ 推荐量化
  - 右：结论 + 预计速度（估算）+ 文本链「详情」
  - 无 Popover、无卡片内量化下拉

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

### 5.1 默认视图（非技术用户）

1. **Hero**：名称、参数量、许可。
2. **本机结论（首屏唯一重点）**
   - 徽章：**流畅** / **可用** / **不推荐**
   - **一句人话**：例：「在 GPU 0 单卡可完整加载，GPU 1 仍可同时跑向量模型。」
   - **预计速度**：`约 35–45 tok/s（估算）` — 必须来自 §8.3 公式
   - 次要：推荐量化 · 推荐上下文 · 文件大小
3. **量化版本表**（推荐行标 ★）

| 量化 | 文件大小 | 结论 | 预计速度（估算） |  |
| --- | --- | --- | --- | --- |
| Q4_K_M ★ | 5.0 GB | 流畅 | 35–45 tok/s | 下载 |

4. **Sticky Footer**：唯一渐变/实心主色按钮「下载并安装」

### 5.2 「详细」折叠区（技术）

- **GPU 分配**：每卡模型名 + 权重/KV/缓冲堆叠条（权重 GB ≈ GGUF 文件大小，不另造「4.2G 权重 + 5.1G 文件」）
- **放置策略**：单卡 / 跨卡 layer split（及原因）
- **系统内存**：全 GPU 时显示「未使用 CPU 卸载」；有 offload 才列出 MiB
- **上下文滑块**：联动 KV 重新估算
- **速度怎么来的**：展示带宽公式与代入值（见 §8.3）
- **兼容与校验**（原「运行时证据」改名）：文件校验、对话模板、工具调用、视觉附件等 — 不用「探针」「GGUF 元数据 API」等措辞

### 5.3 上下文过长时

- 人话提示：「上下文调太高可能装不下，建议降到 XXK。」

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

### 8.1 显存与放置（客户端）

- **权重大小**：默认等于所选 GGUF **文件大小**（分片则求和）；全 GPU 加载时 **权重显存 ≈ 文件大小**。
- **KV + 缓冲**：由上下文长度、KV 量化与模型结构估算（实现复用现有 memory estimate，不对用户展示模块名）。
- **放置**：先判单卡是否足够 → 足够则 `split-mode none`；不足再 layer split 并降级结论文案。

### 8.2 示例数字自洽（双 4060 Ti 16GB · Qwen3-8B-Instruct · Q4_K_M · 32K）

| 项 | 值 |
| --- | --- |
| 文件大小 | 5.0 GB |
| GPU0 权重 | 5.0 GB |
| GPU0 KV（32K） | ~1.0 GB |
| GPU0 缓冲 | ~0.3 GB |
| GPU0 合计 | ~6.3 GB / 16 GB → **流畅**，单卡 |
| GPU1 | Embedding 0.6B ~0.6 GB 或空闲 |
| CPU 卸载 | **无**（0） |

### 8.3 tokens/s 带宽估算（UI 必须标注「估算」）

**Decode 阶段近似（带宽受限）**：

```text
effective_bandwidth_GBps = gpu_memory_bandwidth_GBps × η
decode_tok_per_s ≈ effective_bandwidth_GBps × 1024³ / bytes_read_per_token
```

- **η（效率系数）**：默认 **0.6**（内核/量化/批大小等综合折损，可随实测校准）。
- **bytes_read_per_token**：带宽瓶颈时近似取 **当前加载的 GGUF 权重体积（字节）**（与文件大小一致；更精细实现可按层/缓存命中修正，但 UI 仍标「估算」）。
- **硬件峰值带宽（GDDR6 参考）**：

| GPU 档 | 带宽 (GB/s) | η=0.6 有效带宽 |
| --- | --- | --- |
| RTX 4060M | 256 | 153.6 |
| RTX 4060 Ti 16GB | 288 | 172.8 |
| RTX 4090M | 576 | 345.6 |

**示例（Qwen3-8B Q4_K_M，文件 5.0 GB，单卡 4060 Ti）**：

```text
decode_tok_per_s ≈ 172.8 × 1024³ / (5.0 × 1024³) ≈ 34.6 tok/s
```

UI 展示区间 **35–45 tok/s（估算）**：中心值 ±~15% 覆盖 KV/批大小/驱动波动；**禁止**无公式依据的整数。

**跨卡 layer split**：在带宽估算基础上再乘 **0.55–0.75** 惩罚系数（PCIe），结论文案同步降级。

**有实测**：安装后 benchmark 写入 `measured_tok_per_s`，UI 优先显示「实测 XX tok/s」，估算退居次要。

### 8.4 目录增强（zhiyuanBackend / 种子 SQLite）

建议扩展 `CatalogModel`（设计层，非本 PR 实现）：

- `capabilities[]`：含 `asr` | `tts` | `video` | `ocr`
- `deviceFitProfiles[]`：`{ tier: 'dual-4060-8g' | 'dual-4090-16g' | ...; minVramMiB; notes }`
- `benchmarkTokensPerSec[]`：`{ quant, hardwareTier, p50, p90, source }`
- `ggufMeta`: layer/head 供 KV 精确估算

### 8.5 tokens/s 展示规则（产品）

- 默认：**带宽公式区间 + 「估算」** 后缀
- 有实测：**实测优先**，估算折叠
- 跨卡 split：必须提示速度可能下降
- 禁止精确单值冒充实测

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

- 结论不仅靠颜色：图标 + **流畅 / 可用 / 不推荐** 文案
- 「估算」速度在默认视图可见；公式仅在「详细 → 速度怎么来的」
- 禁止用户可见 copy 出现：Work 模式守卫、ggufKvCacheEstimate、tensor split、运行时证据 等内部词；改用「跨显卡切分」「文件校验」「对话模板」等
- 用户可见字符串走 `t()`；GB 与 `formatBytes` 一致

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
- [ ] 单卡可放时不跨卡；GPU 分配视图正确
- [ ] 详情默认人话；技术仅在「详细」
- [ ] tokens/s 来自带宽公式且标「估算」
- [ ] 下载可选 ModelScope / hf-mirror
- [ ] 本地模型页展示运行显存与诊断
- [ ] lite / 无 GPU / 目录失败 空态齐全
- [ ] 明暗主题 recipe 完整
- [ ] 未在页面写局部颜色 bypass theme

---

## 14. 附录：硬件档与精选策展表

客户端检测硬件 → **映射最近档位** → 市场「为本机精选」**只读该表**，不临时打分凑数。

### 14.1 档位定义

| 档位 ID | 配置 | 带宽 (GB/s) ×2 |
| --- | --- | --- |
| `dual-mobile-4060-8g` | 64GB + 2×RTX 4060M 8GB | 256 |
| `dual-4060ti-16g` | 64GB + 2×16GB 4060 Ti 级 | 288 |
| `dual-4090-16g` | 64GB + 2×4090M 16GB | 576 |

### 14.2 策展表示例（`dual-4060ti-16g`）

| 槽位 | 模型（目录 ID 占位） | 角色 | 推荐量化 | 默认 GPU |
| --- | --- | --- | --- | --- |
| 主对话 | `qwen3-8b-instruct-gguf` | 通用对话/代码 | Q4_K_M | GPU 0 单卡 |
| 并行向量 | `qwen3-embedding-0.6b-gguf` | 记忆/检索 embedding | Q8_0 | GPU 1 |
| 进阶对话 | `qwen3-14b-instruct-gguf` | 更强推理 | Q4_K_M | GPU 0 单卡（~10GB 级） |
| 小模型 | `qwen3-4b-instruct-gguf` | 低延迟 | Q4_K_M | GPU 0 或 1 |

**4060M 8GB 档**：主槽推荐 `qwen3-4b` / `qwen3-8b` Q4；`qwen3-14b` 标 **可用** 且提示「需跨卡切分或降上下文」— 非精选首屏。

### 14.3 静态稿示例硬件

静态 HTML 统一模拟 **`dual-4060ti-16g`**，数字与 §8.2、§8.3 一致。
