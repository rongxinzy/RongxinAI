# Pi 完成闸门评估基线（#1267）

关联：[工作包 J / #1267](https://github.com/rongxinzy/RongxinAI/issues/1267)。本文是评估方法与源代码清单，不是新的任务台账，也不是去留批准。盘点基线为 `0911c7a8c388a99abb51063245fc855c03a6fbc4`。

## 本次能证明什么

`tests/replay/gateDecisionFixtures.test.ts` 直接调用生产控制器和研究策略，用合成输入比较：

- 同一缺失 next/done 的事件序列，在已启动/未启动控制器下的续跑请求数；另以显式 done、显式 next 作对照。
- 连续缺失信号时的 wrap-up 上限与 activation；fixture 用尽而尚未终止不能算完成。
- 研究证据完整的合成状态，与每次仅缺一项阈值的状态；验证单项差异只触发对应失败原因。
- 证据阈值通过但 reviewer 未通过仍不能满足完成判定。

运行：`bunx vitest run tests/replay/gateDecisionFixtures.test.ts`。

这里的 `agentEnds` 是输入控制器的事件数，`continuationRequests` 是它返回的续跑决策数，`terminated` 仅表示控制器不再要求续跑。**三者都不是实际模型轮数、任务成功率或交付质量**。合成状态中的来源/文件只是已验证记录的占位数据，没有联网验证；不证明来源独立性、内容真实性或文件有效性。测试没有模型调用，不报告零 token、节省 token 或收益百分比。

未启动控制器是现有合法状态的参考，不是已经实现的“只移除缺失信号闸门”实验臂。阈值测试是输入敏感性比较，也不是删除阈值后的模型行为 A/B。测试不修改生产 prompt、门禁、权限或默认值。

## 逐项清单与待验收证据

下表“频率”均为**待采样**：代码可证明触发条件，不能证明真实用户触发率。activation 已有部分埋点，但不能把合成样本分布当作生产频率。每项最终去留和迁移方案仍需在 #1267 逐项确认。

| 机制 / 当前代码 | 要解决的问题及触发条件 | 本次确定性覆盖 | 仍缺的收益证据 / 决策 |
| --- | --- | --- | --- |
| `piAgentLoop.ts` / `piRuntimeTurnEvents.ts` 外层续跑 | 已启动 loop 的 agent_end；显式 next、缺 next/done 或领域 gate 未通过会续跑，最多 20 次含收尾 | 缺信号、显式信号、未启动及上限；复用 `HarnessActivationEvent` | 缺信号续跑究竟补全任务还是徒增轮数；按任务难度分层，保留/移除/原生 hook 迁移待定 |
| `piResearchPolicy.ts` 迭代 ≥3 | 防止过早停止；完成时不足 3 轮 | 3 对 2，其余证据满足 | 简单研究是否必须三轮；独立质量评分、token 和真实轮数 |
| 同文件子问题 ≥3 | 覆盖面；完成时问题数量不足 | 3 对 2 | 对窄问题的额外拆分是否改善质量 |
| 同文件已验证来源 ≥6 | 来源覆盖；不足六条 | 6 对 5 | 根据任务规模的收益，不以数量替代可信度 |
| 同文件一手来源比例 ≥0.3 | 原始依据；比例不足 | 2/6 对 1/6 | 一手资料不可得任务的误阻断率 |
| 同文件方向 ≥3 | 多角度研究；方向记录不足 | 3 对 2 | 有效新方向与重复改写的区分 |
| 同文件每轮 isolated researcher | 独立探索；任一轮无研究员记录 | 缺第 3 轮研究员 | 委派成本与独立发现的净收益 |
| 同文件逐问题 claim、claim 文本和双来源 | 可审计证据；缺 claim/文本/双 URL | 本次仅构造满足条件基线；既有研究测试另见下文 | URL 数量不等于独立来源；误报/漏报、质量收益待测 |
| 同文件 contradiction check | 避免单边证据；缺矛盾扫描记录 | 仅满足条件基线 | 记录存在与真实扫描质量须分开评分 |
| `piResearchRun.ts` / `piResearchPolicy.ts` reviewer PASS | 独立审查；请求完成后 reviewer 未通过会继续 | 纯完成策略失败原因，不执行 reviewer | 审查拒绝率、纠正收益、重复审查开销 |
| 研究 deliverable / validation 记录 | 确保报告和验证材料；缺任一角色 | 仅满足条件基线 | 记录门与实际产物正确性独立评估，不以“停机”冒充交付 |
| `piShortcutWorkflow.ts` / `piShortcutWorkflowPolicy.ts` | 快捷任务的产物/验证/预览、扩展名、Office 完整性；DeepResearch 另有角度、研究员、来源和 host 数量 | 本次未新增；既有 shortcut tests | 按任务类型逐项采样，避免将格式完整性与配额类控制混成一个实验臂 |
| `workbenchTask/verification.ts` | 最终答复、流状态、领域 workflow 状态 | 本次未新增；既有 Workbench tests | 正常停止与用户目标达成的区别；verification 状态分布 |
| `workbenchTask/deliveryGate.ts` | 产物失败标记失败，待验收交付转 AcceptanceRequired | 本次未新增 | 验收状态准确性；它本身不是额外模型续跑的证明 |
| `workbenchTask/riskClassifier.ts` | 工具执行前的风险/审批边界 | 不纳入本次消融 | 安全边界不是完成闸门，不得因 token 指标而移除 |
| `piWriteTokenLimit.ts` | write 因 length 截断，steer 提示分块，最多 3 次并去重 | 本次未新增；既有截断恢复 tests | 截断恢复成功/失败率、重复 steer 成本，和不恢复的交付损失 |

## 现有设施能否复用

- `src/main/libs/agentEngine/piAgentLoop.test.ts`、`piResearchRun.test.ts`、`piShortcutWorkflow.test.ts` 和 `piWriteTokenLimit.test.ts` 覆盖局部行为。新增成对 fixture 是决策基线，不替代这些测试或集成验证。
- `src/main/harness/measurementService.ts` 记录模型画像、activation、失败和验证数据。后续采样应保留这些既有标识，并明确定义每项分母（有资格触发的 run / completion attempt），不能只数总 activation。
- `tests/piLongTaskReplay.test.ts` 与 `tests/replay/piLongTaskScenario.ts` 是完整 adapter 的固定 32 文档任务严格 seq+hash provider 回放。可检验生产行为漂移，不会生成改变 prompt 后的真实模型反应。
- `tests/abLongTask.harness.test.ts` 支持 live/record 和 sequential 调试。sequential 忽略请求差异，因此**不能**当不同闸门策略的有效 A/B；同一磁带不能回答“删门后模型如何改变行为”。
- `src/main/evaluation/zhiyuanEvaluationPolicy.ts` 为原生 Pi 的 Inspect 执行提供产品资源，明确不覆盖桌面审批/领域 workflow。不能将这条原生路径的成绩直接视为所有生产门已评估。

## 下一步有效对照

1. 在 #1267 明确首个待评估候选（优先缺 next/done 自动续跑及研究固定配额），本次不批准删除。保留独立交付评分和安全审批。
2. 固定任务集、模型及版本、推理参数、工具/权限、预算和环境；每项只改变一个候选机制，至少覆盖简单、复杂与失败任务。先做小规模有界 pilot，再约定正式样本数，不能以单条示例代表总体收益。
3. 按 run 保存提交 SHA、配置、任务 ID、原始 provider usage（缺失则标未知，注明缓存输入/输出）、实际模型轮数、activation、结束原因、超时/预算耗尽和独立产物评分。预先定义成功条件，报告成功/失败双方成本，不能只保留成功样本。
4. 为每个改变模型输入的实验臂独立录制，strict 回放验证复现；不得用宽松匹配或修改历史磁带伪造对照。失败录制不得覆盖唯一已验证基线；保存新路径并验证后替换。
5. 根据结果逐项决定保留/移除；保留的再评估 Pi 原生 extension/hook 路径。经用户逐项确认、实现及相应回归/真实运行验收后，才满足 #1267 关闭条件。

[#1274 的后续评论](https://github.com/rongxinzy/RongxinAI/issues/1274#issuecomment-6290197972) 已说明 10 月 20 日 token 当时可用，重录推迟到首个 H/J 行为变更 PR；不能继续把“用户没提供 key”当既定阻塞。本离线测试不读取凭证、不探测该服务、不发付费模型请求；真实对照须另行确认当前可用的授权环境与明确预算。
