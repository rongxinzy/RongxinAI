# Skill Python 分层精简 + 内置 OCR 设计方案（2026-10-22）

## 0. 决策与范围

产品判断：**办公能力优先**。随包离线提供 Office 三件套 + PDF + 基础 OCR；其余重依赖（scipy/statsmodels、CAD）首次使用时在线安装。

本轮已定（2026-10-22）：

1. **docx 的 .NET 运行时一起补**：自包含 + 裁剪的 CLI 随包，解决「干净机器只能走受限兜底」（§8.1）。
2. **CAD 与 regression-insight 不随包**：在线安装，用户可在设置里装，也可以由 agent 在对话中触发。
3. **小依赖留在包里**：code-safety-audit / programming-tutor / database-inspector / sql-tutor / py-perf-analyzer 全部随包，core 因此从 141 MB 升到 176 MB。
4. **OCR 只做 Windows**：macOS/Linux 不做离线 OCR，回退到视觉模型或让用户粘贴文本。
5. **不做离线整包**：内网客户通过可配置的 PyPI 镜像/私有索引解决。
6. **7z 档位下调**：当前 `mx=9 solid` 构建慢、收益小，见 §4.1 实测后改为 `mx=5 solid`。

本方案要解决两件事：

1. `resources/skill-python` 目前 1,165 MB（7z 191.8 MB，占 495 MB 安装包的 38.7%），其中只有 13.2% 服务默认启用技能，一个 opt-in 的 CAD 预设吃掉 865 MB。
2. OCR 现在是「只在无视觉模型时给模型一句 PowerShell 命令」，扫描版 PDF 完全不可读（`read_document` 明确说 OCR 不支持），与「办公能力强」冲突。

## 1. 现状基线（实测，2026-10-22）

| 口径 | 数值 |
| --- | --- |
| `resources/skill-python/layers/shared` 磁盘 | 1,165 MB（site-packages 1,110 MB + 层内复制的一份 CPython 约 55 MB） |
| `skill-python.7z`（`lzma2-mx9-solid`） | **191.8 MB**，压缩约 4~5 min |
| 安装包 | 495.4 MB |
| 首装展开 | 69 s（`component=skill-python`） |
| 目标 core（office3 + pdf + 5 个小依赖） | site-packages **176.1 MB / 7,778 文件**，7z `mx=9` 33.4 MB、`mx=5` 34.8 MB |

按 Skill 拆分（闭包 / 相对 core 的增量）：

| Skill | 随包 | 闭包 | 相对 core 增量 |
| --- | --- | --- | --- |
| `text-to-cad`（CAD 专家预设） | 否 | 955.6 MB | **865.1 MB**（vtk 310.8、cadquery-ocp 153.7+61.9、playwright 104.8、scipy 102.9、sklearn 26.2、sympy 25.6、ezdxf 14.6） |
| `regression-insight` | 否 | 224.1 MB | 约 145 MB（scipy 102.9、statsmodels 38.1） |
| `code-safety-audit` | 是 | 20.8 MB | 0（core 本体） |
| `programming-tutor` | 是 | 12.3 MB | 0（core 本体） |
| `database-inspector` / `sql-tutor` | 是 | 6.6 MB | 0（core 本体） |
| `py-perf-analyzer` | 是 | 1.6 MB | 0（core 本体） |
| `xlsx` / `pdf` / `zhiyuan-expert-manager` | 是 | 79.8 / 102.3 / 0.2 MB | 0（core 本体） |

根因三条：

1. `listRequirementFiles`（`scripts/setup-skill-python-runtime.js`）递归扫 `SKILLs/**/requirements.txt`，不看 `skills.config.json` 的 enabled，也不看在用 preset，于是 opt-in 预设的 865 MB 进了全量层。
2. 单一 `shared` uv 环境装所有依赖，per-Skill `runtime.json` 只做 `requirementsSha256` 门（`src/main/libs/skillPythonRuntime.ts`），不隔离包，结构上无法按 Skill 裁剪。
3. 层内又复制一份 CPython（`Scripts/DLLs` 17.7 MB、`tcl` 5.3 MB、`include` 1.9 MB），而 `python-win` 组件已经有一份。

## 2. 目标能力矩阵

| 能力 | 离线随包 | 说明 |
| --- | --- | --- |
| XLSX 读写/分析 | 是 | openpyxl 3.1.5 + pandas 2.3.3 + numpy 2.5.4 |
| PDF 生成/读取/拆分/渲染 | 是 | reportlab 4.5.1、pypdf 6.21.2、pypdfium2 4.30.0、matplotlib 3.11.2、pillow 11.3.0 |
| DOCX | 是 | 自包含裁剪的 `MiniMaxAIDocx.exe`（OpenXML SDK 3.5.1），不再依赖用户装 .NET |
| PPTX | 是 | pptxgenjs 4.0.1（Node，随 skills 组件，与 Python 层无关） |
| 图片 OCR | 是（仅 Windows） | Windows.Media.Ocr，0 字节；非 Windows 明确降级 |
| 扫描版 PDF OCR | 是（仅 Windows） | pypdfium2 光栅化 + Windows OCR，复用 core 层，不新增依赖 |
| 无视觉模型时的图片理解 | 是 | 附件落盘后自动 OCR，用文本替换图片 part |
| 小依赖技能（审计/教学/SQL/性能） | 是 | 5 个技能合计约 39 MB raw，包含在 core |
| `regression-insight` | 在线安装（约 145 MB） | 首次用到时自动装，进度可见、可取消 |
| `text-to-cad`（CAD 预设） | 在线安装（约 865 MB） | 用户显式确认，或对话中由 agent 触发 |

体积预算（目标，按 §4.1 的 `mx=5 solid`）：

| 指标 | 现状 | 目标 | 本轮实测 |
| --- | --- | --- | --- |
| `skill-python.7z` | 191.8 MB | **≤ 60 MB** | **51.3 MB**（层 241 MB / 9,710 文件） |
| 安装包 | 472.5 MB | **约 360 MB** | **350.7 MB**（含 docx 运行时） |
| 安装后 `resources/skill-python` | 1,165 MB | **约 250 MB** | **242.9 MB** |
| 首装展开（skill-python） | 69 s | **约 20 s** | **17.1 s** |
| 整包安装总耗时 | 114 s（升级） | **约 60 s** | **50.3 s**（升级）/ **37.8 s**（全新安装） |
| 每次版本变更的保留税 | 约 1.1 GB/份 | **约 0.24 GB/份** | 0.24 GB（清理脚本未生效，见 §12） |
| docx 运行时 | 无（只能走受限兜底） | 约 30–35 MB | **79.6 MB**（不裁剪，原因见 §8.1） |

OCR 本身增加的包体：**0 字节**（PowerShell 脚本复用已随包的 pypdfium2/pillow）。

## 3. 分层设计（manifest v3）

### 3.1 目录与 schema

打包产物：

```
resources/skill-python/
  layers/core/                      # 唯一随包的依赖层
    Scripts/python.exe ...          # 只留运行所需：python.exe、python3.exe、python314.dll、DLLs、vcruntime*
    Lib/site-packages/...           # core 锁的并集（61 个 dist）
    runtime.json                    # {version:3, kind:'layer', layerId:'core', packages:{name:version}, pythonVersion, uvVersion}
  locks/core.txt                    # core 并集锁（含 hash）
  locks/<skillId>.txt               # 每 Skill 全量锁（保留，用于离线排查与全量构建）
  locks/<skillId>.delta.txt         # 相对 core 的增量锁（运行时安装用）
  skills/<skillId>/runtime.json     # {version:3, skillId, requirementsSha256, coverage:'core'|'overlay', delta:{packages, sha256, bytes}}
```

用户目录（可写，随版本重建）：

```
%APPDATA%\ZhiYuanAgent\runtimes\skill-python/
  layers/<skillId>/                 # --target 安装的增量包目录（不是 venv）
    *.dist-info/...
    runtime.json                    # {version:3, layerId:<skillId>, lockSha256, installedAt}
  wheels/                           # UV_CACHE_DIR，保证重装与离线可用
```

`layers/<skillId>` 刻意不用 venv：venv 会把 `home` 绑到打包目录里的 base 解释器，而应用每次升级都会换 contentId（junction 换靶）导致所有 venv 失效，且每个 venv 复制一份 stdlib。用 `uv pip install --target` + `PYTHONPATH` 注入，解释器永远取当前 core，覆盖目录与解释器解耦。

### 3.2 解析顺序

`skillRuntimeRunner.resolveRuntime`（`src/main/libs/skillRuntimeRunner.ts`）改为调用新 API：

```ts
type SkillPythonResolution =
  | { kind: 'ready'; python: string; sitePackages?: string }
  | { kind: 'dependencies-missing'; skillId: string; bytes: number; deltaPackages: string[] }
  | { kind: 'runtime-missing' };

resolveSkillPython(skillId, requirementsPath): SkillPythonResolution
```

内部顺序：

1. 读 `skills/<skillId>/runtime.json`，`requirementsSha256` 与当前 Skill 的 `requirements.txt` 不一致，返回 `runtime-missing`（保持现有语义：Skill 被用户改过，禁止用陈旧依赖）。
2. `coverage === 'core'`，返回 `{kind:'ready', python: corePython}`。
3. `coverage === 'overlay'`：存在 `layers/<skillId>/runtime.json` 且 `lockSha256` 匹配，返回 `{kind:'ready', python: corePython, sitePackages: layers/<skillId>}`；否则 `dependencies-missing`。
4. 只为该 Skill 的子进程加 `PYTHONPATH=<overlay>`，**不**把覆盖目录加进全局 PATH，保证 shell 里的 `python` 仍然只有 core 承诺的那几个库。

`coverage` 在构建期算好（`delta.packages.length === 0` 即 core），运行期不做 import 试错，避免每次调用多几百毫秒。

### 3.3 按需安装

```ts
ensureSkillDependencies(skillId): Promise<{ok:true} | {ok:false, reason:'offline'|'failed'|'cancelled', detail:string}>
```

实现：`uv pip install --target <layers/<skillId>> --python <core python> --requirement locks/<skillId>.delta.txt --no-deps --link-mode copy`。环境复用 `configureUvForManagedPython`（`src/main/libs/uvRuntime.ts`）：它设 `UV_PYTHON`、`UV_NO_MANAGED_PYTHON`、`UV_CONFIG_FILE`，并调用 `applyUvPackageIndexDefaults(env, {overwrite:true})` 固定索引，镜像与 `HTTPS_PROXY` 走同一套配置。该函数把 `UV_CACHE_DIR` 指向 `runtimes/uv-cache`，本方案在其后覆盖为 `runtimes/skill-python/wheels`，让 Skill 依赖的 wheel 与应用自身的 uv 缓存分离，可整体清理。成功后写 `runtime.json`（含锁哈希与体积）。

`--no-deps` 是必须的：delta 锁里刻意不含 core 已满足的包，若让 uv 正常解析，它会把这些“缺失”的传递依赖从索引重新装一遍，并挑一个新版本（实测 core 有 pandas 2.3.3，却装了 pandas 3.0.6），体积与版本契约同时失效。加 `--no-deps` 后只装锁里列出的包，`scipy 1.18.1 + statsmodels 0.15.0` 直接跑在 core 的 pandas 2.3.3 上，import 通过。

- **幂等**：先写 `<dir>.tmp` 再原子 rename；失败保留旧目录，已下载 wheel 留在 `wheels/` 供重试复用。
- **离线**：`wheels/` 里有 wheel 时用 `--offline` 直接命中；无缓存且无网络时返回 `offline`。
- **体积策略**：小于 200 MB 的直接装（进度 toast + 可取消）；865 MB 的 CAD 先弹确认（体积、预计时间），确认后再装。
- **重装策略**：应用升级换 core 不需要重建覆盖目录（与解释器解耦）；只有 `delta.txt` 哈希变化才重装。

### 3.4 触发点

- **agent 触发（对话中）**：`run_skill_script` 遇到 `dependencies-missing` 直接进入安装流程——小包自动装、CAD 先要用户确认（工具返回 `needs_confirmation` 与体积，模型据此向用户询问，用户同意后再次调用即开始安装）。装完自动重试一次原脚本。
- **手动**：设置 - Skills 行内「安装依赖 / 已安装 145 MB / 卸载依赖」；IPC `skillPython:dependencies:status|install|cancel`。
- **失败语义**：工具错误码 `SKILL_DEPENDENCIES_UNAVAILABLE`，带 `skillId`、`missingBytes`、`offline`，模型据此告诉用户「启用该技能需联网安装约 X MB」，而不是报「脚本不存在」。

### 3.5 构建期过滤（core 的定义）

`scripts/setup-skill-python-runtime.js` 增加显式 core 清单，不再按目录全量扫描：

```js
const CORE_SKILL_IDS = [
  'xlsx', 'pdf', 'zhiyuan-expert-manager',
  'code-safety-audit', 'programming-tutor',
  'database-inspector', 'sql-tutor', 'py-perf-analyzer',
];
```

- 只有 id 在 `CORE_SKILL_IDS` 内、且不是 preset 路径、且不被 `skills.config.json` 标为 `enabled:false` 的 requirements，进入 core 锁。
- 其它所有 `requirements.txt` 仍生成每 Skill 锁、`delta` 锁与 `runtime.json`（`coverage:'overlay'`），不改变 Skill 的 manifest 契约。
- 构建期断言：`core.txt` 的包集合等于 `layers/core/Lib/site-packages` 里的 dist 集合，漂移即失败。
- 顺手去掉层内 `include/`、`tcl/`（无 tkinter 调用），保留 `DLLs` 与 `vcruntime*`，约 -7 MB raw。

## 4. 打包与体积门禁

- `scripts/nsis-offline-components.json` 的 `skill-python` 哨兵改成 `skill-python/layers/core/Scripts/python.exe`；组件标签改为「办公/PDF 运行环境」。
- 组件 contentId 由内容哈希算出，层变小后自动换 id，旧版本由 `cleanup-after-install.ps1` 回收，上线后第一次升级会顺带清掉 1.1 GB 的旧层。
- `scripts/ci/windows-installer-size-smoke.test.ts` 目前只报数不设限；新增组件级预算断言 `skill-python.7z <= 45 MB`，并在 release-preflight 里输出各组件体积明细，防止再次悄悄涨回去。
- mac / linux 的 `extraResources` 同样只带 `layers/core`。

### 4.1 压缩档位（实测，2026-10-22）

对目标 core（176.1 MB / 7,778 文件）用真实 7z 参数测体积、压缩耗时、解压耗时：

| 档位 | 体积 | 相对 mx9 | 压缩 | 解压 |
| --- | --- | --- | --- | --- |
| `mx9 solid`（现状） | 33.4 MB | 0% | 40.8 s | 11.5 s |
| `mx7 solid` | 34.2 MB | +2.2% | 31.8 s | 12.6 s |
| **`mx5 solid`（建议）** | **34.8 MB** | **+4.2%** | **18.3 s** | 12.0 s |
| `mx9 nonsolid` | 44.3 MB | +32.6% | 21.4 s | 13.2 s |
| `mx5 nonsolid` | 44.8 MB | +34.0% | 19.2 s | 13.4 s |
| `mx3 nonsolid` | 47.7 MB | +42.8% | 8.5 s | 13.9 s |

结论：

1. **solid 必须保留**：非 solid 体积 +33%，解压反而更慢（分块解压 + 更多文件头）。
2. **解压时间与压缩档位几乎无关**：11.5–13.9 s 是「7,778 个文件落盘」的 I/O 成本（约 1.5 ms/文件）。所以**装包慢的根因是文件数与总量，不是压缩等级**——层从 27,744 文件降到 7,778 文件，69 s → 约 13 s 是瘦身的功劳。
3. **mx9 只在构建侧吃亏**：`skill-python` 从 191.8 MB 的 4~5 min 降到 176 MB 的 41 s（mx9）/18 s（mx5），`mx5` 再省 22 s，体积只多 1.4 MB。
4. **portable-git 调档位没用**：305 MB / 2,525 文件，`BCJ2 d=128m` 在 mx9 与 mx5 下分别是 46.4 MB/79 s 与 46.7 MB/73 s——瓶颈是 BCJ2 滤波器与字典，不是 `-mx`。保持现状即可。

落地：`scripts/windows-resource-pack.cjs` 的 `WINDOWS_RESOURCE_ARCHIVE_COMPRESSION` 全部降到 `mx=5`（`Solid` 与 `NonSolid` 两档、`PortableGitBcj2` 保留 `-mx=9`），并在 manifest 的 `archiveCompression` 里如实写新的 id（`lzma2-mx5-solid-v1` / `lzma2-mx5-nonsolid-v1`），旧包因 id 不匹配自然重建。

### 4.2 真实层复测（构建产物，2026-10-22 晚）

对瘦身后真实层（240.9 MB / 9,657 文件，含解释器）复测同一档位：

| 档位 | 体积 | 压缩 | 解压 |
| --- | --- | --- | --- |
| `mx5 solid`（已采用） | 50.9 MB | 27.8 s | 13.9 s / 19.3 s |
| `mx9 solid` | 48.5 MB | 56.4 s | 14.9 s |
| `mx3 solid` | 57.9 MB | 4.9 s | 13.5 s |

结论不变：`mx5` 用 2.4 MB 换 2 倍压缩速度，解压不受影响；构建日志显示 `skill-python` 打包从原来的 4–5 min 降到 **25.5 s**。`uv`(74 MB)、`skills`(62 MB)、`python`(61 MB) 同理降到 `mx5`，`portable-git` 维持 `BCJ2 d=128m`。

## 5. OCR 设计（仅 Windows）

### 5.1 引擎

`src/main/ocr/`：

```ts
interface OcrEngine {
  id: 'windows-media-ocr';
  available(): Promise<{ ready: boolean; languages: string[]; reason?: string }>;
  recognizeImages(paths: string[], lang?: string): Promise<OcrPageText[]>;   // 批量，一次进程
}
```

扩展现有 `resources/ocr/ocr-image.ps1`：

- 新增 `-Json` 与批量 `-Paths`：一次 PowerShell 进程识别多张图，输出 `[{path, lines:[{text, x, y, w, h}], width, height}]`；
- 语言默认 `zh-Hans-CN`，失败回落 `TryCreateFromUserProfileLanguages()`；
- 用 `OcrEngine.AvailableRecognizerLanguages` 做能力探测，结果缓存 10 min；
- 保留现有的「路径不存在 / 无机器可读文本」两条 stderr 语义（exit 3 / exit 0），单图调用变成批量调用的特例。

非 Windows：`resolveBundledOcrHelper` 维持返回 `null`，工具不出现在工具列表里，`read_document` 的提示文案按平台区分（Windows 提 OCR，其它平台不提）。

### 5.2 扫描版 PDF

`resources/ocr/pdf-pages.py`（用 core 层解释器跑，不新增依赖）：

```
python pdf-pages.py --input x.pdf --pages 1-5 --dpi 200 --out <tmpdir>
```

- `pypdfium2` 渲染、`pillow` 存 PNG；默认 200 DPI、单次最多 20 页、总像素上限 40 MPix，超限截断并回报。
- 主进程逐页调用 OCR 引擎（子进程，主线程不做栅格化/解码），按页拼接「第 N 页」分段。
- 整档超时默认 120 s，可取消。

### 5.3 能力入口

1. 新工具 **`ocr`**（单个，避免工具膨胀）：`{ path, pages?, lang? }`，自动识别图片/PDF；返回文本 + `engine`、`language`、`pages`、`truncated`。
2. `read_document` 回退：PDF 用 `@firecrawl/anydoc` 抽出的 Markdown 去空白后字符数低于阈值（默认 80）时，自动对整档（或前 20 页）跑 OCR，并在结果里标注来源；工具描述里「scanned PDF 不支持 OCR」的说法随之改写。
3. 非多模态模型：`piImageInputFallback` 在 verdict 为 `Unsupported`/`Unknown` 时立即对落盘图片跑 OCR，把图片 part 换成文本块（含文件路径与引擎信息），不再只给一句 PowerShell 命令；历史回放仍保留原命令提示（`resolveBundledOcrHelper` 不动）。文本上限 8k 字符，超出截断并注明。
4. 设置 - 通用新增「本地 OCR」行：引擎、可用语言、是否自动识别无视觉模型的图片（默认开）。

### 5.4 边界与合规

- 主进程不做 CPU 密集活：PDF 栅格化在子进程（Python），解码/拼接只做字符串处理；按 AGENTS.md 的 worker 规则，若后续要在主进程内跑 pdfjs/canvas，必须进 `worker_threads` 并附时延证据。
- OCR 结果必须标明来源，并在提示里要求模型「不要根据 OCR 文本推断颜色、版式、图表内容」，与现有 `piImageInputFallback` 里那句「It returns text only」保持一致。
- 中文标点、竖排、表格识别率不承诺；表格类需求引导到 xlsx 技能或视觉模型。
- 语言包缺失时如实上报可用语言，不假装可用。

## 6. 模型面契约同步（三处 + 一处新增）

| 位置 | 改动 |
| --- | --- |
| `resources/SYSTEM_PROMPT.md` | 新增一段：本地 `ocr` 工具可读图片与扫描 PDF；`read_document` 会在无文本层时自动 OCR；OCR 文本不含版式 |
| `piPythonEnvGuidelines.ts` | 「bash 里 python 预装 pandas/numpy/openpyxl/matplotlib」改为「预装办公/PDF 核心集（四个 + reportlab/pypdf/pypdfium2）+ 代码审计与教学类依赖；CAD/统计类依赖首次使用时安装」 |
| `piBashToolGuidelines.ts` | 注释与拦截文案指向 core 层，解释为什么不再承诺全量依赖 |
| 新 `ocr` 工具描述 | 能力、限制、语言、返回值形状（10 行以内） |

## 7. 迁移与兼容

- `runtime.json` 版本 2 到 3：运行期只接受 v3；旧层随组件 contentId 更换自然失效，不写迁移代码（符合焦土政策）。
- 用户目录里若有 v2 的 `layers/shared`（早期落在 `runtimes/skill-python` 的副本），升级时由组件清理逻辑删除。
- 已装覆盖目录不需要在应用升级后重建（与解释器解耦）；`wheels/` 缓存保留，重装可在离线完成。
- 内网/离线客户：设置里可配置 PyPI 镜像或私有索引（复用 `applyUvPackageIndexDefaults` 的配置面），不再提供全量安装包。

## 8. 需要补齐的能力

### 8.1 DOCX 的 .NET 运行时（本轮做）

现状：docx 主路径是 `dotnet run --project scripts/dotnet/MiniMaxAIDocx.Cli`（DocumentFormat.OpenXml 3.5.1），安装包不带 .NET，本机也没装 `dotnet`，干净机器上只剩 `markdown_to_docx.mjs` 的受限兜底（无模板保真、修订、复杂表、图片）。

实施方案（较初稿改动：不新增 NSIS 组件，避免改动强校验的组件清单契约）：`dotnet publish -r win-x64 --self-contained` 输出到 **`SKILLs/docx/runtime/`**，直接搭载在既有 `skills` 组件里（`skills.7z` 16.2 → 40.3 MB）。

- 构建入口：`scripts/build-docx-runtime.cjs`，已挂到 `bun run build:skills`（本地与 CI 同一条路径）。无 .NET SDK 时警告跳过（保留 `dotnet run` 兜底），`--required` 或 `CI=true` 时硬失败；产物带 `build-info.json`（RID、dotnet 版本、是否裁剪、体积），源码 mtime 更新才重编，发布后清掉 `scripts/dotnet/**/bin|obj`（实测 94 MB，否则会混进 `skills` 组件）。
- **不启用裁剪**：`PublishTrimmed=true` 会关闭 System.Text.Json 的反射序列化，`analyze --json`、`diff`、`edit fill-placeholders` 运行时直接抛 "Reflection-based serialization has been disabled"（2026-10-22 实测，28.2 MB 裁剪版）。不裁剪为 **79.6 MB**，四个命令全部通过；体积换正确性。
- CLI 解析：新增 `SKILLs/docx/scripts/cli.sh`，顺序为 `$ZHIYUAN_DOCX_CLI` → `runtime/MiniMaxAIDocx.Cli.exe` → `dotnet run`；`SKILL.md` 的 `$CLI` 改为 `bash scripts/cli.sh`。
- 环境自检：`scripts/env_check.sh` 先看随包运行时，命中就报 `[OK] docx cli` 并跳过 dotnet 与 NuGet 检查（实测 `Status: READY`）。
- CI：`build-windows-release.yml`、`windows-installer-pr.yml`、`build-inference-editions.yml` 已经 `actions/setup-dotnet@v5`（8.0.x），无需改流水线。

### 8.2 已知风险

- **Windows MAX_PATH**：`%APPDATA%\ZhiYuanAgent\runtimes\skill-python\layers\<skillId>\...` 加深路径可能触 260 字符上限。安装用 `\\?\` 前缀；无法启用长路径时把 layers 放到 `%LOCALAPPDATA%\ZY\sp\<id>` 短根。
- **`--target` 没有 console script**：`Scripts/*.exe` 不会生成（pytest 之类），Skill 脚本一律用 `python -m` 或 `python script.py` 调用。
- **版本遮蔽**：覆盖目录里若带 core 同名包，`PYTHONPATH` 会优先命中覆盖目录。这是有意的按 Skill 隔离，但要为「core 有 pandas 2.3.3、覆盖装 pandas 3.0」补一条测试。
- **首次安装需联网**：镜像/私有索引配置错误时错误信息要可读，不能卡在解析阶段。
- **OCR 语言包**：`Windows.Media.Ocr` 需要系统装了对应语言的 OCR 包，缺失时回落用户语言，中文图片可能识别为空。

## 9. 测试与验收

单测：

- 覆盖判定：`delta.packages.length===0` 即 core；core 锁与层内容一致性断言。
- 解析矩阵：core 命中、overlay 命中、overlay 缺失、Skill 被改动（哈希不匹配）、core 缺失。
- 安装编排：`uv` 参数、`UV_CACHE_DIR`、离线分支、原子 rename、失败保留旧目录、取消。
- OCR：引擎抽象（mock spawn）、批量 JSON 解析、空白图（stderr 提示但 exit 0）、PDF 页范围解析、`read_document` 回退阈值。
- 压缩：manifest 里 `archiveCompression` 与 `WINDOWS_RESOURCE_ARCHIVE_COMPRESSION` 一致；非预期档位不得进入 manifest。
- 契约：三处提示词与新工具描述的快照测试（防漂移）。

集成（Windows，`bun run test:full`）：

- 真实 OCR：zh/en/空白三张 fixture，断言子串与「无文本」分支。
- 扫描 PDF：3 页 fixture（含中文），`ocr` 与 `read_document` 两条路径都出文本，页序正确。
- 安装链：`regression-insight` 脚本首次调用触发安装，成功后脚本可跑；CAD 走确认分支；断网时错误码正确。
- docx：打包后的 exe 跑 `create`/`validate`，与 `dotnet run` 产物做结构比对。
- 打包链：slim 构建，断言 7z 不超过 45 MB、`layers/core` 包集合等于 core 锁，静默安装后跑 xlsx/pdf/docx 脚本，卸载残留检查。

验收：主线程无超过 50 ms 卡顿；10 页扫描 PDF OCR 不超过 15 s；安装包不超过 350 MB；安装目录不超过 240 MB；`dist:win` 打包耗时下降 ≥30%。

## 10. 分阶段

| 阶段 | 内容 | 预估 |
| --- | --- | --- |
| P0-a | core 过滤 + core/delta 锁 + 层瘦身（含去掉 include/tcl）+ 压缩档位下调 + 体积门禁 | 1 天 |
| P0-b | 解析/安装编排 + `run_skill_script` 接入 + IPC/设置入口 + 错误契约（含 CAD 确认分支） | 1.5 天 |
| P0-c | OCR：PS1 批量 JSON、`ocr` 工具、`read_document` 回退、无视觉模型自动 OCR、PDF 页渲染脚本 | 1.5 天 |
| P0-d | docx：自包含裁剪 CLI + 组件 + 包装脚本 + CI `setup-dotnet` | 1 天 |
| P0-e | 三处提示词同步 + 单测/集成 + 真机安装验证（复用 10-22 的升级/安装脚本） | 1 天 |

## 11. 本轮落地状态（2026-10-22）

| 阶段 | 状态 | 证据 |
| --- | --- | --- |
| P0-a core 过滤 + core/delta 锁 + 层瘦身 + 压缩档位 | 完成 | 层 241 MB / 9,710 文件；`skill-python.7z` 51.3 MB（原 191.8）；安装包 350.7 MB（原 472.5，且新增 docx 运行时）；打包 25.5 s（原 4–5 min） |
| P0-b 解析 / 按需安装 / 错误契约 | 完成 | `resolveSkillPython` + overlay `PYTHONPATH` + `uv --target --no-deps`；在**安装后的应用**里用自带 uv + delta 锁装 `regression-insight`，`scipy 1.18.1 + statsmodels 0.15.0` 跑在 core `pandas 2.3.3` 上 |
| P0-c Windows OCR | 完成 | PS1 批量 `-Json`/`-Status`/`-PathsFile`；`pdf-pages.py` 光栅化；`ocr` 工具；`read_document` 回退；安装包内实测：引擎 `ready zh-Hans-CN`，扫描 PDF 经光栅化 + OCR 出中文文本 |
| P0-d docx 自包含 CLI | 完成 | 本机装 .NET SDK 8.0.426 后产出 79.6 MB 运行时；安装后 `bash SKILLs/docx/scripts/cli.sh` 正常，`create` / `analyze --json` / `validate` / `fill-placeholders` / `diff` 全部通过，`env_check.sh` 报 READY |
| P0-e 模型面同步 + 测试 | 完成 | `SYSTEM_PROMPT.md`、`piPythonEnvGuidelines`、`piBashToolGuidelines`、`ocr`/`docx` 提示；新增 5 组单测，相关 65 项通过 |

安装 / 卸载实测（2026-10-25 包，350.7 MB）：

| 场景 | 结果 |
| --- | --- |
| 升级（2026.10.24 运行中 → 2026.10.25） | 50.3 s，exit 0；`process-stop` + 组件展开 22.8 s，`skill-python` 17.1 s；安装后 242.9 MB、docx 运行时 79.6 MB、`ocr/pdf-pages.py` 就位 |
| 全新安装 | 37.8 s（组件缓存命中），`install-complete total_ms=37235` |
| 启动 | 5 个进程，`shell ready (+241ms)`，日志仅存量告警 |
| 卸载（`/currentuser /S`） | 目录与卸载注册表项清除，`%APPDATA%\ZhiYuanAgent` 保留 |

## 12. 遗留问题

1. ~~`cleanup-after-install.ps1` 一直返回 exit=1~~ **已修复（2026-10-22）**：根因是组件版本目录里存在超过 MAX_PATH 的路径（jedi typeshed、OCP `.libs` 等），PowerShell 的 `Get-Item`/`Get-ChildItem` 在这些路径上报 “Cannot find path”，递归删除抛出后整脚本 exit 1，于是每次升级都留下旧的 1.1 GB 版本（本机累积了 4 份约 2.5 GB）。改为在 `\\?\` 长路径上用 .NET API 枚举与删除（保留 reparse point 检查），并把单个版本的删除失败降级为 stderr 告警、继续清理其余版本。实测：同一台机器上手工运行脚本，3 个陈旧版本（1,073 + 1,164 + 61 MB）全部回收、`current` 保留，`runtimes` 从约 3.4 GB 降到 841 MB，exit 0；新增 “`reclaims a stale version whose files sit past MAX_PATH`” 回归用例（18 项全部通过）。
2. 设置页的「安装依赖 / 已安装」入口与 IPC 未做；当前由 agent 在对话中触发（首次调用返回确认提示，用户同意后带 `confirmDependencyInstall` 重试），小依赖直接自动安装。
3. 安装器从工作区目录启动会卡住（本机沙箱的 Low IL 限制），需从 `Downloads` 等普通目录运行；这不是产品缺陷，但测试时要注意。