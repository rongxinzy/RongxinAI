# Windows 安装器全自绘 UI 设计规格

日期：2026-10-11。状态：实施基线（路线 A：保留 electron-builder + NSIS 引擎，整体替换视觉层）。

目标安装体验对标国际大厂（OpenAI / Google 桌面产品）：干净的品牌窗口、单主动作、无 MUI 默认向导痕迹。安装逻辑（`scripts/nsis-installer.nsh` 的杀进程、组件解包/激活、回滚、时序日志）零改动，只替换表现层。

## 硬约束（来自 electron-builder 26.16.1 模板调研）

- include（`nsis.include`）先于所有 `MUI_PAGE_*` 插入点求值：`!define` / 可覆盖宏全部生效。
- `MUI_PAGE_INSTFILES` 无条件插入、无法移除；进度无逐文件回调（整个安装是单个 Section，原生进度只跳一次）。自绘进度只能：SHOW 回调隐藏原生控件 + 自建控件；阶段文案在 `customInstall` 的显式阶段边界更新。
- 命令行 define 可用 `!undef` 撤销：`allowToChangeInstallationDirectory` 可移除以取消原生目录页。
- 可覆盖宏：`customWelcomePage`、`customPageAfterChangeDir`、`customFinishPage`、`customUnWelcomePage`、`MUI_CUSTOMFUNCTION_GUIINIT`、`MUI_PAGE_CUSTOMFUNCTION_*`、全部 `MUI_*` 外观 define。
- 静默（/S）：所有页面回调完全不执行。UI 代码只允许出现在页面回调内；`customInit`/`preInit` 路径静默也执行，禁止放 GUI 代码（现状已遵守，保持不变）。
- `customInstall` 在解包 Section 末尾追加，阶段边界都在这里。

## 页面流（交互安装）

1. **欢迎/选项合一页**（custom `Page custom`，替代 MUI welcome + 目录页 + 原本地推理页）
   - 品牌背景（浅、点阵语言，延续现有 asset 风格但主色更新为 `--zy-primary #0F6BF2`）
   - 顶部：应用图标 64px + 「知远智能体 / ZhiYuan Agent」字标区
   - 中部：一行价值文案
   - 安装位置行：`$INSTDIR` 只读展示 + 「更改…」（`nsDialogs::SelectFolderDialog`）
   - 「安装本地推理组件」复选框 + 说明文案（迁移现有 LocalInference 页内容）
   - 许可协议：复选框 + 「已阅读并同意《许可协议》」（链接用 `ExecShell open` 打开包内 license 文本）
   - 底部右侧主按钮「安装」（原生主题化按钮 + 600 字重），左侧「取消」
   - Leave：`PrepareExistingInstallForExtraction`（从原 LocalInference 页 Leave 迁移至此）
2. **进度页**（instfiles SHOW/LEAVE 回调皮肤化）
   - 同款品牌背景；中央：大标题「正在安装知远智能体」+ 阶段文案行 + 品牌色 marquee 进度条（`PROGRESS_CLASS` + `PBM_SETMARQUEE`，不确定态，对标 Office "getting things ready"）
   - 阶段文案按 `customInstall` 真实阶段边界更新（校验 → 展开各组件 → 激活 → VC 运行时 → 清理），由 `ZY_ProgressPhase` 宏写入
   - 隐藏原生 1004 进度、1016 详情列表、页眉全部控件；保留原生取消机制（不可见，用户关窗 = 取消）
   - 阶段边界同时保留现有 `DetailPrint` 时序日志行为
3. **完成页**（customFinishPage）：成功态图标 + 「安装完成」+ 「启动知远智能体」主按钮（`runAfterFinish` 语义，写 `$runAppAfterInstall`）+ 「完成」次按钮
4. **卸载确认**（customUnWelcomePage）：品牌背景 + 「确定要卸载知远智能体吗？」+ 「卸载」主按钮 / 「取消」

安装模式页（per-user/per-machine）：需确认本构建是否插入 `PAGE_INSTALL_MODE`（检查 `multiUser.nsh` 中 `INSTALL_MODE_PER_ALL_USERS` 的定义条件）。若出现则保留原生页但用 SHOW 回调做品牌背景融合；优先评估强制 current-user 使其不显示（应用 runtime 全部 per-user，语义一致）。

## 视觉规范

- 主色 `#0F6BF2`（DESIGN.md `--zy-primary`）；微背景 `#EFF6FF`；正文 `#1F2937`；次文本 `#6B7280`；细边界 `#E5E7EB`
- 字体：Segoe UI / Microsoft YaHei UI（跟随系统，原生 CreateFont）；字号三档：标题 14pt、正文 9pt、说明 8pt
- 背景：白→`#F5F9FF` 纵向微渐变 + 低密度冷灰点阵（延续 `generate-nsis-brand-assets.cjs` 的 drawDots 语言）
- 圆角/阴影：不做（NSIS 原生控件无圆角能力； Win11 主题按钮自带现代观感，与对标产品一致）

## 资产（`scripts/generate-nsis-brand-assets.cjs` 扩展）

生成到 `build/installer-assets/`（24-bit BMP，NSIS `LoadImage` 兼容）：

| 资产 | 尺寸 | 用途 |
| --- | --- | --- |
| `zy-bg.bmp` | 1350×684（3× 内容区 450×228px） | 内容区品牌背景 |
| `zy-band.bmp` | 994×126 | 页眉带背景（覆盖原 MUI 库存页眉区域） |
| `zy-wordmark.bmp` | 360px 宽 | hero 页正式字标（白底） |
| `zy-bar-track.bmp` | 600×28 | 进度轨道（直切左/圆角右，兼作滑动 mask） |
| `zy-bar-fill.bmp` | 600×28 | 进度填充（左圆角，右端齐切） |
| `zy-bar-complete.bmp` | 600×28 | 100% 填充（双圆角） |
| `zy-done.bmp` | 192×192 | 完成页成功态品牌圆+白勾（底色压平 #F5F9FF） |
| `zy-side.bmp` | 436×772 | 卸载器原生完成页侧图 |
| `license.txt` | — | 仓库 LICENSE 拷贝，hero 页许可链接打开 |

`installerHeader.bmp` / `installerSidebar.bmp` / `uninstallerSidebar.bmp` 已删除（生成逻辑与 electron-builder.json 引用一并移除）。

## 已验证实测几何（96 DPI，MUI2 预览）

- 窗口 503×362（client 497×333）；内容区 450×210px @ client(18,63) = 300×140 dialog units（1u = 1.5px 两轴一致）；页眉带 497×63px。
- 开发回路：`.cache/nsis/makensis.exe`（gitignored）+ `node scripts/installer-ui/build-preview.cjs [--run] [--from=progress|finish|uninstall]`。

## 文件结构

- `scripts/installer-ui/zy-theme.nsh` — 颜色/几何/字体常量、`ZY_SetPageChrome`（隐藏 MUI 页眉、铺背景）、`ZY_ProgressPhase`、`ZY_CreateBrandBg` 等绘图宏
- `scripts/installer-ui/zy-pages.nsh` — 各页 Create/Leave 函数与字符串表
- `scripts/installer-ui/preview.nsi` + `scripts/installer-ui/build-preview.cjs` — 独立预览 harness：stub Section 模拟阶段边界，makensis 编译后直接运行看 UI（不依赖 build-tar/完整打包）
- `scripts/nsis-installer.nsh` — 只改页面接线与阶段文案调用，安装逻辑不动

## 验证

- `tests/nsis-installer.test.ts` 增补：页面接线断言、静默安全断言（UI 宏仅在页面回调内）、资产清单断言
- 预览 harness 实机截图验收（浅色；125%/150%/200% DPI；窄文本溢出；zh/en）
- 完整 `dist:win:offline` 构建 + 交互安装走查在具备构建环境的机器上执行
