# 导航切换与历史树渲染修复验证

## 问题与修复

在历史会话分组展开时，点击待办、自动化、活动或专家，旧页面会停留数百毫秒才更新。`App` 更新当前页面后，`Sidebar` 随之渲染，历史树也在同一轮重新生成。数据缓存和树的常驻挂载可以避免重新读取、保留展开状态，但不能跳过 React 渲染。

本次只调整 `Sidebar.tsx` 和 `agentSidebar/MyAgentSidebarTree.tsx`：稳定关闭搜索、创建自动化任务的回调，并给历史树增加默认浅比较的 `React.memo` 边界。历史树继续订阅 Redux 和语言变化，保留自己的展开、预览、分页及弹层状态。没有自定义忽略 props 的比较器，没有修改 DOM、主题、数据读取、IPC、存储或窗口行为。

## 测量方法

- 基线：远端 main `072068ff861498041097457bc8248dd4b1215782` 的导航渲染路径。
- Windows 上运行 `bun run electron:dev`；同一 Electron 实例、同一数据库、工作模式、相同分组展开及 53 条历史行，页面模块已经预热。
- 用捕获阶段 click 时间戳到目标页面 DOM 更新的 MutationObserver 回调测量延迟；另外记录下一次 requestAnimationFrame。后者不是屏幕实际呈现时间。
- Playwright 经 CDP 驱动真实控件点击；没有 CPU 降速、CPU profile 或 React commit 采样。切换序列为待办 → 自动化 → 活动 → 专家，重复两遍。
- 修复前恢复普通树导出与内联 props；修复后恢复 memo 和稳定回调。两轮每一次采样均为 53 行，工作及对话会话数据引用没有改变。
- 同时读取当前 React root 中树的直接子节点 props 引用：前一轮每次均重新生成，后一轮每次均复用。它与回归测试的实际节点渲染计数共同验证 memo 生效。
- 首次热更新使内存分页预览从 64 行变为 53 行，因此首次前后采样不用于计算改善比例；下面采用补做的相同行数对照。

## 逐次结果

单位为 ms，保留一位小数。

| 次序 | 目标页面 | 修复前点击到 DOM | 修复后点击到 DOM |
| --- | --- | ---: | ---: |
| 1 | 待办 | 763.8 | 275.0 |
| 2 | 自动化 | 717.1 | 140.1 |
| 3 | 活动 | 774.6 | 159.9 |
| 4 | 专家 | 770.1 | 157.6 |
| 5 | 待办 | 783.9 | 179.8 |
| 6 | 自动化 | 777.2 | 130.1 |
| 7 | 活动 | 808.2 | 151.1 |
| 8 | 专家 | 763.3 | 153.0 |
| 中位数 | | 772.3 | 155.3 |

中位数降低约 **80%**。历史树子节点 props 复用为修复前 **0/8**、修复后 **8/8**。自动化、活动和专家页面仍有自己的渲染成本，本次没有承诺所有切换低于某个固定时限。

此前更新 main 后的记录为：64 条历史行、8 次导航，364.2–627.8ms，中位 434.3ms；本次修复后的 130.1–275.0ms 也低于该范围。但行数、预热及运行状态不同，不能用此前记录计算受控改善比例，更不能将开发态测量等同于生产包性能。

可分享的原始数据与下一帧记录：[measurements.json](../../.github/pr-assets/navigation-history-renders/measurements.json)。它不包含会话内容、标题或路径。

## 自动化检查

- `bunx vitest run src/renderer/components/Sidebar.rendering.test.ts src/renderer/components/Sidebar.search.test.ts src/renderer/components/SidebarNavigationControls.interaction.test.ts src/renderer/components/shell/SidebarNavigationView.test.tsx src/renderer/components/agentSidebar/workspaceSessionPreviews.test.ts`：5 文件、24 项通过。
- 新测试使用真实 Sidebar、历史树、工作区状态 hook 和 Redux；模拟 IPC 服务及下游工作区行。旧实现的导航测试失败（工作区行渲染调用从 6 次增到 20 次）；修复后导航不增加调用。
- 覆盖导航后的展开与预览保留，以及选择、工作区选中、流状态、未读、重命名、语言更新、批量选择和替换自动化回调。memo 不冻结这些必要更新。
- `bun run lint`：通过，零警告，包含 theme:check / theme:audit。
- `bun run build:tsc`、`bun run format:check`、`git diff --check`：通过。
- 未运行全量测试与生产打包。定向 Vitest 直接运行，不触发测试包装脚本对运行中 Electron 原生模块的重建。

## 设计自查

依据 `DESIGN.md`「六、布局与组件范式」的侧栏约束、「八、动效、交互状态与连续性」、「九、主题包实现与验证边界」及「十、落地检查清单」。组件继续复用共享 Button、菜单和删除确认；本次不改视觉 recipe、token、文本或组件结构。

实际运行长安风物主题，验证 light/dark 热切换；视口为 1280×800、900×700，侧栏宽度均为 260px，无文档横向溢出。键盘 Tab 进入专家导航，`:focus-visible` 为 true，选中会话数在切主题期间保持为 1。导航截图裁剪到品牌、模式与功能入口，以排除用户项目和会话内容：

| 视口 | 浅色 | 深色 |
| --- | --- | --- |
| 1280×800 | [light-1280.png](../../.github/pr-assets/navigation-history-renders/light-1280.png) | [dark-1280.png](../../.github/pr-assets/navigation-history-renders/dark-1280.png) |
| 900×700 | [light-900.png](../../.github/pr-assets/navigation-history-renders/light-900.png) | [dark-900.png](../../.github/pr-assets/navigation-history-renders/dark-900.png) |

按落地清单逐项记录（“不适用”仅指本次差异）：

| 检查项 | 结果与依据 |
| --- | --- |
| 1. 外观归 recipe | 不适用：没有外观差异，原有 recipe 归属不变 |
| 2. 字号、行高、字重 | 不适用：未修改 |
| 3. 间距与圆角 | 不适用：未修改 |
| 4. 弹窗密度与侧栏行 | 不适用：未修改结构和样式 |
| 5. 阴影、浮层与输入岛 | 不适用：未修改 |
| 6. 主次操作和空状态 | 通过：没有删减操作；导航键盘焦点可达；相关搜索测试通过 |
| 7. 输入选择器、按钮和图标 | 不适用：未修改共享控件及其外观 |
| 8. 顶栏、Tabs、分段及确认 | 不适用：未修改，继续复用原有组件 |
| 9. 侧栏分组及卡片结构 | 通过：DOM 分组和结构无差异，截图已检查 |
| 10. 配置面板与表单 | 不适用：未修改 |
| 11. 交互状态及组合 | 通过：导航选中、键盘 focus-visible 和会话选中已实际验证；展开、批选、动态状态有回归测试。其余控件外观状态未修改 |
| 12. 动效与减少动效 | 不适用：不增加或修改动画、时序及 reduced-motion 行为 |
| 13. 原地加载与真实指标 | 通过：没有增加占位或人为等待，延迟与缓存引用有实际数据 |
| 14. 窄窗口、长文及 portal | 窄窗口通过，无横向溢出；语言更新有测试。长文与 portal 实际运行未重新验证，本次未改其实现 |
| 15. 明暗热切换与状态保留 | 通过：长安风物 light/dark、两种尺寸已验证，选中会话保留；导航展开和预览保留有测试。实际草稿、附件与弹层连续性未重新验证 |
| 16. 品牌及用户内容 | 通过：沿用正式品牌资源，没有新增重着色或用户内容样式 |
| 17. 生成、审计与格式 | 通过：lint、theme:check/audit、format:check；未改 token/recipe，无需生成主题 |
| 18. 共享契约与引擎 | 不适用：未改共享契约或引擎；新增测试已运行 |
| 19. 开发模式关键流程 | 导航及主题切换已实际验证；搜索、选择、未读等由定向测试覆盖。发送模型请求、权限批准/拒绝、停止、Artifacts 全流程未重跑，本次没有改动这些路径 |

无获准设计偏离。模式切换仍会改变批量选择集合和可见会话回调，此项单独优化不在本 PR 范围内。尚未完成生产包基准测试及首次回归提交定位。
