# 工作 / 对话模式切换延迟修复

## 触发条件与根因

工作历史展开、没有批量选择时切换工作 / 对话模式，即使会话数据没有变化，历史树仍重新渲染并阻塞内容提交。常驻挂载和预览缓存只能避免重建与读取，不能自动跳过 React 渲染。

基于最新 main `4240f54ca0e5d51d202950a745e66bb63d970e63`，已经包含合入的导航修复 #999。本 PR 不重复其修改。`Sidebar.handleWorkModeChange` 每次都创建空 `Set`，工作树的 `onVisibleSessionsChange` 又在函数和 `undefined` 间变化，使现有默认浅比较 memo 失效。

本次仅修改 Sidebar：空选择复用引用，已有批量选择仍清空并退出；工作树始终收到稳定回调，只写工作范围，聊天范围从聊天节点独立派生；全选与勾选状态按当前模式取对应范围。隐藏工作树的异步预览不能覆盖聊天全选范围。

没有修改组件挂载策略、缓存、视觉样式、文案、动效、模型配置广播、IPC、持久化结构或主进程。仍使用默认 memo 比较，真实选择、流状态、未读、标题和语言更新继续传播。清除不匹配当前会话的原有行为保持有效，不承诺该必要更新也零重绘。

## 受控测量

同一 Windows Electron/Vite 开发实例（5175 / CDP 9222）、同一数据库、同一构建模式、相同展开状态和 **53 条工作历史 / 20 条聊天历史**。工作树常驻，聊天时 DOM 共 73 条历史行。StrictMode 保持开启，没有 CPU 降速、CPU profiler 或 React commit 采样。前后均启用 CDP focus emulation，记录每次 `visibility=visible`、`focused=true`，结束恢复该调试设置。

每轮源文件热更新后等待 3 秒，将原选中会话保存并暂时清空，进入已预热 Cowork 空会话页再等待 5 秒。真实点击模式控件，前 4 次双向切换作为预热，随后 **16 次全部纳入统计（每方向 8 次）**。1200ms 采样间隔在测量区间外，产品代码没有新增等待。测量期间不并行跑 lint、测试或构建。

起点是捕获阶段 click；终点是 MutationObserver 同时确认 Redux 模式、工作树 hidden 状态、当前模式历史行和主页 caption 对应内容状态已经提交。另存后续 requestAnimationFrame，**不等同于屏幕呈现时间或 INP**。采样期间每次验证工作 / 聊天 sessions 引用、预览缓存、工作树实例和展开属性不变。

| 点击到内容 DOM 更新（ms） | 修复前中位数 | 修复后中位数 | 降低 | 修复前范围 | 修复后范围 |
| --- | ---: | ---: | ---: | --- | --- |
| 工作→对话，8 次 | 844.9 | 422.8 | 50.0% | 731.7–1126.8 | 289.2–589.7 |
| 对话→工作，8 次 | 884.0 | 343.9 | 61.1% | 818.5–1125.6 | 197.5–470.4 |
| 合计，16 次 | **880.4** | **359.5** | **59.2%** | 731.7–1126.8 | 197.5–589.7 |

合计 p95（nearest-rank）1126.8→589.7ms；样本较少，p95 恰为最大值，只作分布描述。后续 rAF 中位数 932.8→528.1ms。工作树直接子节点 props 复用 **0/16→16/16**；修复前每次变化的 props 都是 `selectedIds`、`onVisibleSessionsChange`，修复后没有变化。

| 次序 | 方向 | 修复前 ms | 修复后 ms |
| --- | --- | ---: | ---: |
| 1 | 工作→对话 | 797.9 | 289.2 |
| 2 | 对话→工作 | 853.7 | 197.5 |
| 3 | 工作→对话 | 847.6 | 361.6 |
| 4 | 对话→工作 | 885.8 | 373.6 |
| 5 | 工作→对话 | 833.1 | 523.3 |
| 6 | 对话→工作 | 878.7 | 330.7 |
| 7 | 工作→对话 | 842.2 | 581.3 |
| 8 | 对话→工作 | 882.1 | 310.0 |
| 9 | 工作→对话 | 731.7 | 589.7 |
| 10 | 对话→工作 | 818.5 | 470.4 |
| 11 | 工作→对话 | 1108.3 | 433.6 |
| 12 | 对话→工作 | 1051.2 | 357.1 |
| 13 | 工作→对话 | 928.1 | 412.1 |
| 14 | 对话→工作 | 1125.6 | 274.5 |
| 15 | 工作→对话 | 1126.8 | 331.5 |
| 16 | 对话→工作 | 953.7 | 357.4 |

[原始记录、预热样本、逐次缓存验证、恢复结果及统计](../../.github/pr-assets/work-chat-switch/measurements.json)不包含会话内容、标题或路径。开发实例已有用户数据，未发模型请求，未创建或删除会话。每轮结束恢复原工作模式、页面和会话；选中会话恢复后历史回到 64 行，未将恢复阶段计入测量。

最初 64 行记录、焦点条件未控制的探索轮，以及发生后台节流或中途数据刷新的整轮均排除于收益计算；原文件保存在本地独立证据目录 `C:/Users/Administrator/.codex/artifacts/work-chat-switch-20261015/`。没有选择性删除受控轮中的慢样本，没有混用上一份导航测量的数字。

限制：这是共享桌面上顺序 A/B 的开发态基准，操作系统负载不可控，没有随机交叉试验或生产包基准。聊天列表仍在进入时挂载；配置广播仍可能引发模型刷新，贡献未单独量化。本次收益只归于已测得的工作树隔离，仍有 197.5–589.7ms 的剩余延迟。未锁定近期首次退化 PR，不能把 #907 等历史优化归为回归来源。

## 回归验证

- `node node_modules/vitest/vitest.mjs run src/renderer/components/Sidebar.rendering.test.ts src/renderer/components/Sidebar.search.test.ts src/renderer/components/SidebarNavigationControls.interaction.test.ts src/renderer/components/shell/SidebarNavigationView.test.tsx src/renderer/components/agentSidebar/workspaceSessionPreviews.test.ts src/renderer/components/agentSidebar/batchSelection.test.ts`：6 文件，30 项通过。
- 新用例使用真实 Sidebar、MyAgentSidebarTree、工作区状态 hook、Redux 和共享 Checkbox，模拟 IPC 服务与下游行。双向切换不变历史不增加行渲染；展开、预览与节点保留；退出批量、双模式全选、隐藏工作树延迟预览返回、隐藏时选中 / 运行 / 未读 / 标题 / 语言更新全部覆盖。
- 原 Sidebar 上新双向渲染用例失败：行渲染调用从预热后的 6 次增至 14 次；修复后保持 6 次。测试验证有效行为，未关闭 StrictMode 或抑制必要订阅。
- `npm run lint`：通过，零警告，含 theme:check / theme:audit；`npm run build:tsc`、`npm run format:check`、`git diff --check` 通过。Impeccable 机械检查对 Sidebar 返回空结果。
- 直接运行 Vitest，避免测试包装器对运行中 Electron 共用的原生模块进行重建。未运行全量测试、Vite 生产打包及生产性能测试。
- 使用现有 `electron:dev` 实例进行真实模式切换与明暗主题验证，没有停止或启动其他开发实例。
- 实际点击历史菜单进入批量并全选，按工作→对话→工作复核：工作范围 65 个聚合预览 ID（含折叠组中的预览），聊天范围恰为 20 个聊天 ID；切换后批量退出、选中清零；回到工作模式全选范围恢复，未混入聊天 ID。没有执行删除。[batch-check.json](../../.github/pr-assets/work-chat-switch/batch-check.json)记录结果和原会话恢复。

## 设计自查

依据 DESIGN.md 六（侧栏及共享组件）、八（状态连续性与动效）、九（主题验证边界）、十（落地清单）。本次没有 DOM 层级、样式、token、recipe、文案或动画差异，继续复用原共享控件。没有新颜色、字号、间距、圆角、阴影、CSS、控件或设计偏离。

实际验证长安风物 light/dark，1280×800 与 900×700，两模式共 8 组；260px 侧栏、模式反馈、Tab focus-visible 和无水平溢出均通过。主题、模式、页面和原选中会话已恢复。截图只截品牌 / 模式 / 导航入口，排除项目与会话内容。结果见 [design-check.json](../../.github/pr-assets/work-chat-switch/design-check.json)。

| 视口 | 工作浅色 | 工作深色 | 对话浅色 | 对话深色 |
| --- | --- | --- | --- | --- |
| 1280×800 | [截图](../../.github/pr-assets/work-chat-switch/light-work-1280.png) | [截图](../../.github/pr-assets/work-chat-switch/dark-work-1280.png) | [截图](../../.github/pr-assets/work-chat-switch/light-chat-1280.png) | [截图](../../.github/pr-assets/work-chat-switch/dark-chat-1280.png) |
| 900×700 | [截图](../../.github/pr-assets/work-chat-switch/light-work-900.png) | [截图](../../.github/pr-assets/work-chat-switch/dark-work-900.png) | [截图](../../.github/pr-assets/work-chat-switch/light-chat-900.png) | [截图](../../.github/pr-assets/work-chat-switch/dark-chat-900.png) |

落地清单：外观、字体、间距、密度、阴影、输入选择器、顶栏、Tabs、表单、品牌、portal、disabled/invalid 和动效 recipe 在本差异中不适用；未修改这些定义。选中与批量 checked 状态、缓存和展开、语言及动态数据由回归覆盖；模式切换、明暗热切换、窄窗口和键盘焦点由实际实例验证。没有增加占位、清缓存、关闭 StrictMode 或延迟显示已就绪内容。

未重新执行发送模型请求、权限批准 / 拒绝、停止、Artifacts、草稿 / 附件 / 弹层全流程，本次未修改这些路径，不宣称其全流程验收。回滚只需撤销本提交，不涉及数据迁移。
