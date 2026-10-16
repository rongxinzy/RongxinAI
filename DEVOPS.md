# 轻量 DevOps 规范

本仓采用知远跨仓协作规范。完整说明：[统一 DevOps 规范](https://github.com/rongxinzy/zhiyuan-docs/blob/main/guides/devops.md)。本文件提供离线可用的最小规则；本仓已有安全、设计、契约和发布检查继续执行。

- 变更通过 PR 合入默认分支，一份 PR 聚焦一个问题。
- 标题使用 `type(scope): summary`，scope 可省；英文、小写动词开头，尽量不超过 72 字符。类型使用 feat/fix/docs/refactor/test/perf/build/ci/chore/revert；破坏兼容用 `!` 并说明影响。
- PR 说明必填：改了什么、为什么、实际验证及结果。通常三段即可，中文或英文均可；未运行或阻塞项明确写出。
- bug fix 说明触发条件、原行为、原因和修复后行为；可重复行为缺陷优先加回归测试，不能合理自动化时说明原因与手工验证。小修复不强制开 issue。
- 所有 PR（含文档）默认需一次正式 GitHub approval，新增提交使旧 approval 失效；仅管理员可通过 PR 绕过 review。独立 AI 可辅助审查，但评审报告或作者自审不替代正式 approval；高影响变更由维护者确认。
- AI review 在 PR 记录 reviewer、提交 SHA、结论和未解决事项；权限/密钥、不可逆迁移或删除、生产发布策略等高影响变更需维护者确认。
- CI、门禁脚本及触发配置变更需维护者检查 diff 与适用工作流是否一致；绿色 CI 不能替代这项 review。
- 合并前相关检查及现有必需 CI 通过、阻断意见已处理、说明与最终 diff 一致；默认 squash，已有合并策略优先。新增实质修改后复核相关变化。
- 跨仓变更链接依赖 PR，并在需要时说明兼容和发布顺序。合并、构建、部署、业务验收分别记录，不能相互代替。
- 紧急生产修复保留 PR、最小验证与回滚说明，取得 approval 且通过必需 CI 后合并；下一工作日补充完整验证，不绕过分支保护和安全/发布门。

CI 统一必需项为 `ci-gate`：要求同一 CI 运行中的 `merge-gate` 通过。路径归属的检查（渠道运行时冒烟、Python 运行时、安装器预览）已并入 CI 条件 job；`.github/devops-ci.json` 仅登记 CI 工作流。文档或 `website/` 改动仍要跑 lint、渲染器类型检查、单元测试、构建和 bundle-budget；安装回归、内存回归、企业扩展工具链和路径归属检查按 diff 跳过。同一 PR 的新提交会取消仍在跑的 CI。默认分支保护要求 PR、一次 approval、解决评审讨论、必需 CI；禁止强推和删除，仅管理员可通过 PR 绕过 review，CI 与禁止强推/删除仍适用管理员。套餐不支持的私有仓只能运行 CI，保护需升级后应用，不能宣称已强制。picoclaw 的冻结状态不变。
