# Daimon Skill 方法论蒸馏台账

本台账记录对 Daimon 目录中 38 个 Skill 的方法论审阅结果。目标不是复制
上游提示词或其平台专属 API，而是把可迁移原则放入知远的 Skill、Pi harness
和构建门禁；每一项必须能落到可执行的交付、验证或边界上。

## 已内化的通用原则

1. **路由先于执行**：按任务类型选择工作流与工具，不能用一个泛化提示替代。
2. **产物先于叙述**：文件型任务必须留下真实交付物，不以计划、源码或声称的路径完成。
3. **独立验证**：静态/结构检查、运行检查和渲染检查各自记录；有缺口就继续而不是结束。
4. **状态与恢复**：长任务保存状态、阶段和证据；Pi 的循环只把 `done` 视为完成请求。
5. **最小授权与诚实边界**：外部行动、法律/医疗/投资判断、私有数据与不确定事实都要显式限制。
6. **可发布性**：Skill 元数据、依赖运行时和构建资源都是交付的一部分，必须受 CI 约束。

当前实现位置包括 `piShortcutWorkflow*`、`piResearch*`、`piWorkExecution.ts`、
`SKILLs/{presentation-studio,docx,xlsx,frontend-design,deep-research}` 和
`validate:skills`。这些机制是 Pi 兼容的：保持 agent loop、工具调用和用户接受
的控制权，不引入一个替代 Pi 的中央规划器。

## 逐项覆盖

| Daimon Skill | 处理 | 蒸馏后的落点 |
| --- | --- | --- |
| ad-creative | 等价内置 | 视觉资产要求、真实预览与交付证据。 |
| automation | harness 原则 | 长任务状态、结果工件、可恢复执行；不复制 Daimon Automation API。 |
| binding | harness 原则 | 交付物与验证/预览必须通过 `deliverablePath` 绑定。 |
| blueprint | harness 原则 | 路由、模式化步骤、可验证结果；网站快捷入口要求 HTML、验证与渲染预览。 |
| campaign-plan | 直接内置 | 目标、受众、渠道、指标和可执行日历。 |
| canvas | 平台专属原则 | 以文件/预览交付替代 Canvas API，保留展示前验证。 |
| churn-prevention | 直接内置 | 先收集上下文、按模式输出、指标与行动清单。 |
| content-research-writer | 直接内置 | 多角度研究、来源核验、引用报告与 QA。 |
| copy-editing | 直接内置 | 多轮聚焦检查、证据与风险检查。 |
| copywriting | 直接内置 | 受众、主张、证据和 CTA 的结构化写作。 |
| daily-report | 等价内置 | 持久报告、进度/风险/下一步的可审阅交付。 |
| daimon-widget-cards | 平台专属原则 | 文件型结果作为一等交付物呈现，不复制卡片协议。 |
| deli-autoresearch | 直接内置/harness | 防停滞、状态、研究子任务、证据链和验证报告。 |
| docx | 直接内置 | 结构验证、Pandoc 受控降级、真实渲染与页面检查。 |
| humanizer-zh | 直接内置 | 受众与语气约束，不把润色当作事实验证。 |
| kimi-design-skill | 等价内置 | `frontend-design` 的设计意图、实现、运行与视觉检查。 |
| kimi-slides | 等价内置 | `presentation-studio` 的设计契约、严格验证、编译和整套检查。 |
| kimi-webbridge | 平台专属原则 | 不复制浏览器桥；保留网页运行与预览验收。 |
| legal-risk-assessment | 直接内置 | 风险分级、升级条件和非法律意见边界。 |
| md-to-pdf | 等价内置 | PDF 产物、页面渲染与视觉 QA。 |
| memory-widget | 平台专属原则 | 对话状态不等于交付状态；工作流状态写入工作区。 |
| pdf | 直接内置 | 路由、真实引用、逐页渲染、低内容页检查。 |
| pptx | 被替换 | 不再作为默认快捷入口；由 `presentation-studio` 承担严格质量门禁。 |
| pptx-swarm | 方法论吸收 | 角色分工与独立 QA 吸收进研究/交付证据链，不复制 swarm 框架。 |
| pricing-strategy | 等价内置 | 输入、计算、基准、选择理由和行动项。 |
| process-doc | 直接内置 | 流程图、RACI、SOP 与例外路径。 |
| saas-metrics-coach | 直接内置 | 输入校验、计算、基准与优先级报告。 |
| scientific-problem-selection | 直接内置 | 多方案、风险、证据和决策门。 |
| seaborn-visualization | 方法论吸收 | 精确尺寸、渲染后尺寸检查和视觉边缘检查。 |
| seo-audit | 直接内置 | 可验证审计、证据与优先级建议。 |
| skill-creator | 直接采用原则 | 元数据规范、渐进披露、可验证的 Skill 结构；82 个内置 Skill 受 CI 校验。 |
| theme-factory | 方法论吸收 | 先选择/声明主题，再应用并验证视觉一致性。 |
| theme-kit | 方法论吸收 | 设计 token 与一致性检查由演示/前端 Skill 使用。 |
| ui-blueprint | 方法论吸收 | 先定义交互/界面契约，后实现和运行检查。 |
| webapp-building | 等价内置 | 前端构建、运行、渲染检查和交付绑定。 |
| widget | 平台专属原则 | 不移植 Daimon Widget API；以 HTML、截图和可下载文件交付。 |
| widgetdesign | 方法论吸收 | 响应式布局、数据状态、交互与可见结果验证。 |
| xlsx | 直接内置 | XML/公式验证、LibreOffice 重算、真实 XLSX→PNG 预览。 |

## 当前不变量与验证

- 82 个知远内置 Skill 的 frontmatter 由 `npm run validate:skills` 检查，并在 PR CI 执行。
- PPT、Word、网站、表格和深度研究快捷入口都必须记录可验证交付物；前四类还必须有真实 raster 预览。
- QA/预览记录必须引用已注册交付物，不能用无关文件凑证据。
- 研究还要求多个角度、已完成的研究委派、可访问来源和跨域来源分布。
- Windows、macOS、Ubuntu 的打包流程均在构建前校验私有 Pandoc、uv 与 uv 管理的 Python 3.14.6；macOS 已作真实执行验证。

这份台账是覆盖声明，不是完成声明：每当引入新的第一方快捷入口或高风险
Skill，都必须选择上述某一验证路径，或新增同等强度的可执行门禁和测试。
