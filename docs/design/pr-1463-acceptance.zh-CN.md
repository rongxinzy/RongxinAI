# PR #1463：对话与图片预览验收

日期：2026-11-16。范围：评审意见修复、常驻输入区、生成图片在正文与产物面板中的展示。此记录不替代 Windows/Linux 安装验收，也不代表对真实上游图像生成模型质量的验收。

## 根因与修复

| 场景 | 根因 | 修复与回归 |
| --- | --- | --- |
| 长对话虚拟化与滚动 | 旧版移除虚拟列表并关闭原生锚定，万字流式与长会话 DOM 规模线性增长 | 启用 `@tanstack/react-virtual@3.14.6` Chat 模式（`anchorTo: 'end'`、`followOnAppend: true`、`scrollEndThreshold: 80`）作为 `.cowork-conversation-scroll` 唯一滚动拥有者，配合 `overflowAnchor: 'none'`、底端吸底按钮、TurnNavigator `scrollToIndex` 及导出静态全量通道；验证 1200 轮仅挂载视口附近节点、上滚后不回拉、前插历史位移 <2px |
| `@` 后按 Enter 与富文本草稿 | 编辑器直接按键早于 Mention 插件，手动定位浮层，且切会话仅存纯文本丢属性 | 使用 `@tiptap/suggestion@3.34.0` 原生 `props.mount`（Floating UI `top-start` + `flip`）与插件优先级，`getJSON()` 结构化草稿保留 `mention` 节点的 `id`/`label`/`kind`/`path`；单测与浏览器验证 Enter/Tab 选中与跨会话还原 |
| 投影身份稳定与 steer 配对 | 无界纯映射在每次 delta 全量重建历史 turn，`artifacts` O(turns×artifacts) 扫描，steer 插队后 `tool_result` 跨回合失配 | 接入 `createSessionTurnsSelector()`（`@reduxjs/toolkit` `createSelector` + `maxSize: 6000` `lruMemoize`），历史回合引用恒等、`deliverables` O(artifacts) 索引并支持跨回合 `tool_result` 归位 |
| Diff WorkerPool 与预算保护 | `@pierre/diffs` 默认同步高亮大 diff，单卡自建 Provider 在虚拟化滑出时销毁缓存池，worker 异常静默吞掉 | 在 `SessionStage` 与 `RunSessionModal` 外围通过 `DiffWorkerPoolProvider`（基于 `@pierre/diffs` `WorkerPoolContext` / `getOrCreateWorkerPoolSingleton`）按会话共享 `poolSize: 2`、`totalASTLRUCacheSize: 100` 且在首张预算内 diff 展开时按需拉起；超过 120K 字符或 3000 行、或 worker 失败时退回纯文本摘要而不回退主线程同步高亮 |
| edit/write 失败与折叠状态 | diff 分支跳过工具错误输出，长错误不可展开；虚拟化卸载会重置手动展开的工具卡 | 独立渲染错误详情，保留长输出展开按钮与拟议 diff；通过 React Context 化的 `PersistentToggleNamespaceProvider`（无 render 期全局副作用）在 1200 轮虚拟滚动与弹窗隔离间保持 `ToolPartView`/`ToolGroupView` 展开记忆 |
| 新组件外观 | 局部颜色、字号、圆角、阴影、宽度/高度动画绕过主题 | 注册 conversation hooks/recipe，复用共享 `Button`，补全双主题；仅保留颜色、阴影、透明度过渡 |
| 首页进入会话常驻输入区 | portal/DOM 搬运（`usePersistentComposer` / `moveBefore` / `appendChild`）与绝对定位叠加高度测量（`useCoworkComposerInset`） | 拆除 portal 与 DOM 搬运，将单实例 `<StageComposer>` 固定在 `CoworkSessionLayout` + `ConversationStage` 同一 React 子树位置，保持 `SessionStage` 仅在挂载会话时懒加载分包，跨首页/冷加载/活跃会话/Tab 切换保留编辑器 DOM 与焦点选区 |
| 正文本地图片与特殊文件名 | 默认 Markdown 清洗拒绝 `file:`/盘符；特殊字符 `#`/`?`/`%`/空格与 UNC 路径未区分；失败缓存永久污染 | 在未改动 `rehype-sanitize` + `rehype-harden` 前仅规范化图片 AST，`resolveLocalfileRequestPath`（`node:url#fileURLToPath` + 盘符/UNC）经受控 `localfile://` 加载，`useResolvedLocalPathState` 永不缓存失败结果并支持 `Retry` 重试（含远程/本地图片）与版本刷新 |
| 右侧图片与同路径重生成 | base64 读取受限且错误状态跨产物污染；同路径重生成缓存不失效 | 路径图片直连受控协议；按源隔离缩放/错误；`artifact.createdAt` 变化递增 `imageRevision` 触发 `?v=` 缓存穿透 |

图片安全边界保持：原 Markdown sanitizer、主进程路径解析、受控协议的扩展名/敏感路径校验、SVG 清洗和 HTML 隔离均保留。恶意图片协议与原始 script 有回归断言。

## 设计依据与复用

- DESIGN.md §二工程归属、§三色彩、§四排版、§五尺寸、§六输入岛与消息、§八动效、§九主题、§十四对话面。
- 对照 `docs/design/reference/index.html`、`tokens.css` 和 `stage.css`；既有主界面基准截图保持不变。
- 复用 `Button`、ai-elements `Tool`/`Terminal`/`Message`、共享图片预览弹层及原主题 token。
- 样式入口：`theme/components/conversation.ts`、`conversation-contract.ts`、两套 appearance 共用的 `classic.ts`；CSS 只由生成器输出。
- 无获准设计偏离、无新增用户样式设置、无检查项删除或白名单扩展。

## DESIGN.md §十检查清单

### 视觉判断

- 通过：首页以输入岛为重心；会话以消息/错误内容为重心，导航与元信息保持次级。
- 通过：品牌蓝限于发送、确认、焦点与运行状态；验收画面同时主强调不超过两处。
- 通过：未引入毛玻璃、渐变按钮、光晕、彩色阴影、悬停位移/缩放或呼吸动画。
- 通过：层级使用既有三级文字与三档字重，没有新增字阶和卡片层。
- 通过：菜单/导航按钮使用 32px 共享规格、16px 图标；同类文本起点一致。
- 通过：zh/en 新文案齐全，错误、权限和运行状态有文字/图标语义。
- 通过：与参考输入岛、消息阅读列和中性表面并排检查。

### 规格

- 通过：新增对话外观归注册 recipe；页面保留排列、滚动、视口上限和媒体缩放几何。
- 通过：字阶限既有档位；输入正文 16px、菜单/工具 14px、元信息 12px。
- 通过：间距/圆角沿用既有刻度；导航命中区恢复共享按钮规格。
- 不适用：没有新增表单弹窗或项目导航卡片；既有图片弹层复用。
- 通过：新增表面未增加普通卡片/按钮 hover 阴影；提及浮层有描边并使用既有浮层阴影。
- 通过：正文、元信息、选中、hover/focus 采用原有明暗文字与状态角色，未加入局部颜色或透明文字覆盖。

### 交互与组件

- 通过：候选可用方向键、Enter/Tab、Escape 操作；复制、重编辑及审批使用共享按钮，焦点可达。
- 通过：保留统一 PageHeader/PageTabs、ai-elements 消息/工具及共享图片预览，没有新增标题层级。
- 通过：验证 hover/focus、候选 selected/open、审批 pending/disabled、工具 error/open、图片 failure/retry/switch；invalid 不适用（本轮没有输入校验字段）。
- 通过：常规过渡 120ms，折叠仅透明度 200ms；reduced-motion 下测量为停用过渡；不再动画 width/height。
- 通过：首页→冷加载→会话→首页的编辑器 DOM 身份保留；首轮发送后焦点保留；快速切换与临时 ID 提升不丢草稿。
- 通过：light/dark 分别验证 1280×800、1440×900、1024×768、940×700、760×700，无页面横向溢出，输入与操作可达。
- 通过：运行时修改下一套主题的 editor recipe 字号为 18px，再切换主题，验证新值生效，同时保留草稿、焦点、真实选区、展开工具和阅读锚点；随后恢复 16px。

### 命令与真实能力

- 通过：执行主题生成、lint、格式、类型、单测、构建、包体和浏览器检查，具体结果见下表。
- 通过：浏览器工具未提供，使用仓库 Playwright；既有流式回放与控制台门禁保留。
- 通过：macOS Electron 开发环境使用隔离 `/tmp` 配置与工作区，真实创建文件、走 preload/路径解析/受控协议，正文与右侧图片均解码为 1280×800。验证了损坏文件修复后重试、再切换图片，页面异常为零。
- 未验证范围：Windows/Linux 原生窗口与打包安装、实际模型的图像生成调用、完整 Cowork 模型执行和所有 Artifacts 类型的 Electron 端到端流程；浏览器 mock 不用于证明这些行为。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| `bun run test:unit` | 975 passed，11 skipped（6057 tests passed，85 skipped），含虚拟化、selector 身份稳定性、WorkerPool 会话共享/预算、`PersistentToggleNamespaceProvider`（含 `temp-*` 提升无竞态）、32KB 阈值无空帧回归与 `@` 提及/JSON 草稿回归 |
| `bun run web:preview:check` | 148 passed，1 个既有 fixme（0 failed），冷 `.vite` 缓存验证通过，含 1200 轮虚拟化、流式吸底与上滚不回拉、Markdown/产物图解码重试、`@` 提及草稿持久化、双主题 5 视口设计走查 |
| `bun run build` / `test:bundle-budget` | 通过（8286 modules）；preload 18 files / 0.90 MiB，startup 36 files / 1.79 MiB，最大 chunk 452 KiB，sourcemaps: 0 |
| `build:tsc` / `typecheck:electron` | 通过 |
| `lint` / `format:check` | 通过；328 条存量警告（修改文件零新增告警），518 个主题组件模块审计通过 |
| `knip` / `knip:production` / source line limit | 通过；源码行数上限、preload 契约（460 required / 461 typed）及生成 mock 检查均通过 |
| Electron 真实文件图片 | 前置提交已验证 macOS Electron `localfile://` 两入口及特殊文件名解码，本轮保留同协议与路径解析单测（21 passed）并在 macOS 环境持续约束生效；未复跑完整收费模型对话 |

## 截图

- [浅色 1280×800](../theme-previews/pr-1463/conversation-light-1280x800.png)
- [深色 1280×800](../theme-previews/pr-1463/conversation-dark-1280x800.png)
- [浅色 760×700](../theme-previews/pr-1463/conversation-light-760x700.png)
- [深色 760×700](../theme-previews/pr-1463/conversation-dark-760x700.png)
- [真实 Electron 图片：浅色](../theme-previews/pr-1463/native-images-light.png)
- [真实 Electron 图片：深色](../theme-previews/pr-1463/native-images-dark.png)

Electron 图片测试复用了仓库 1280×800 PNG 作为落盘夹具，证明文件展示链路，不冒充模型新生成的图像。
