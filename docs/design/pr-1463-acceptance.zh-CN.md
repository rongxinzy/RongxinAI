# PR #1463：对话与图片预览验收

日期：2026-11-16。范围：评审意见修复、常驻输入区、生成图片在正文与产物面板中的展示。此记录不替代 Windows/Linux 安装验收，也不代表对真实上游图像生成模型质量的验收。

## 根因与修复

| 场景 | 根因 | 修复与回归 |
| --- | --- | --- |
| `@` 后按 Enter | 编辑器的直接按键处理早于 Mention 插件，先触发发送 | 使用原生插件优先级，让 Mention 先接管候选键；浏览器验证 Enter/Tab 选择不发送 |
| 上滚后加载历史 | 移除虚拟列表后缺少前插锚定，浏览器原生锚定又被关闭 | React 在 DOM 更新前记录可见消息，用唯一滚动拥有者的 setter 补偿；补齐分页从半个回合开始、随后加载用户消息导致 orphan 外壳重建的回归 |
| edit/write 失败 | diff 分支跳过工具错误输出 | 独立渲染错误详情，同时保留拟议 diff；单测与浏览器验证 EACCES |
| 新组件外观 | 局部颜色、字号、圆角、阴影、宽度/高度动画绕过主题 | 注册 conversation hooks/recipe，复用共享 Button，补全双主题；仅保留颜色、阴影、透明度过渡 |
| 首页进入会话 | 两个输入组件分别挂载；常驻后会话切换也不再触发原来的卸载刷写 | 同一 portal/editor 在槽位间移动；切换草稿身份时刷写尚未防抖保存的输入，并保留 temp→real 的下一轮草稿 |
| 正文本地图片 | 默认 Markdown 清洗拒绝 `file:`/盘符；绝对路径可能成为网页请求；文件名空格被 URI 编码后，解析器按字面 `%20` 查找文件 | 只规范化图片 AST，保持原清洗与链接策略；解码一次后由主进程确认路径，再用受控图片协议加载 |
| 特殊文件名与远程图片 | 旧 URL 转换器未编码 `#`/`?`/`%`，也未保留 HTTP(S) 图片 | 区分远程 URI 与本地路径，正确编码文件名；回归包含空格、`#`、字面 `%20`、Windows 路径和远程图片 |
| 右侧图片 | 文件图片先走有 20 MiB 上限的 base64 读取并进入 Redux；旧错误状态还会污染后续图片 | 路径图片直接走受控协议；按源隔离缩放/错误；刷新与重试更新加载版本，不经 base64 读取 |

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
| `bun run test:unit` | 最终完整运行 6042 passed，85 skipped；随后新增半回合锚定回归与相关用例合计 17 项通过，CI 绑定最新提交 |
| `bun run web:preview:check` | 143 passed，1 个既有 fixme；最终设计/回归 15 项验证通过，其中 1 项首次在创建页面阶段超时、单独重跑通过；审批文案另复测 |
| 新图片单测 | 10 passed，含 URI→真实文件候选校验、清洗边界、失败切换/重试及跳过 base64 读取 |
| 草稿/提交补充单测 | 19 passed |
| `bun run build` / `test:bundle-budget` | 通过；startup 1.79 MiB，最大 startup chunk 452 KiB |
| `build:tsc` / `typecheck:electron` | 通过 |
| `theme:generate` / `lint` / `format:check` | 通过；lint 的 328 条存量警告与原始 HEAD 归一化对照完全相同，无新增警告 |
| `knip` / `knip:production` / source line limit | 通过；Knip 保留既有配置提示 |
| Electron 真实文件图片 | 两个入口、特殊文件名、损坏后重试、切换、明暗截图通过；未调用收费模型 |

## 截图

- [浅色 1280×800](../theme-previews/pr-1463/conversation-light-1280x800.png)
- [深色 1280×800](../theme-previews/pr-1463/conversation-dark-1280x800.png)
- [浅色 760×700](../theme-previews/pr-1463/conversation-light-760x700.png)
- [深色 760×700](../theme-previews/pr-1463/conversation-dark-760x700.png)
- [真实 Electron 图片：浅色](../theme-previews/pr-1463/native-images-light.png)
- [真实 Electron 图片：深色](../theme-previews/pr-1463/native-images-dark.png)

Electron 图片测试复用了仓库 1280×800 PNG 作为落盘夹具，证明文件展示链路，不冒充模型新生成的图像。
