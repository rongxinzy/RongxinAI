# Pi harness 边界与验证

2026-11-11，用户授权对 harness 审查发现的阻断做全部修复与清理。原 #1267 的合成闸门 fixture 描述旧控制器的行为，不能证明其对模型质量有收益；这些控制器及其专属 fixture 已移除。本文记录当前边界，不代表相关 GitHub issue 已关闭。

## 原生执行边界

- Pi 管理工具回合、provider 重试、截断恢复与自动/手动压缩；应用只在 `agent_settled` 后结算任务。
- Work 和 Chat 均保留 Pi 原生系统提示、工具说明及指南，应用与专家指令通过 append 注入，不再覆盖原生工具使用基线。
- 不再有 `agent_loop`、`research_state` 或 `workflow_state` 工具，不因遗漏控制信号追加模型请求，不设置固定轮数、评审口令或文件扩展名的完成门禁。
- Goal 模式表达持续推进意图；没有独立循环内核或 20 轮强制收尾。研究、网站、Office 与普通 Work 共用原生完成路径。
- Bash 保留 Pi 原生超时语义；应用不补默认 5 分钟/最大 15 分钟覆盖。子代理继承取消信号，不默认 30 分钟终止，排队中的子任务在取消后不启动。
- 文件写入不强制 2000 字符分块，也不注入第二套截断恢复请求。已退休工作流中的主进程整文件哈希一并移除；实际交付证据仍由有界 artifact worker 收集。

## 宿主职责

- 工具副作用保留审批。等待审批是活动状态，并行审批独立结算；拒绝会暂停任务并清理其他等待项。只读工具、内部检查点和委派本身不重复审批，子代理和 codemode 的实际工具调用仍经审批。
- 子代理工具 ID 按独立会话命名，结果落到对应 run 的审批记录。子代理只收到其实际拥有的工具指引。
- 选中 Skill 的脚本权限和可信根目录在执行时读取；steer 新增技能同步资源根目录。未选技能仍不得执行。
- 主会话和子代理使用按模型窗口计算的压缩预算；模型切换即更新，不依赖输出上限是否变化。
- 固定版本 SDK 的压缩边界补丁按会话记录顺序识别旧消息，避免压缩与后续响应处于同一毫秒时跳过溢出恢复；不在 harness 额外续跑。
- 记忆单次召回沿用项目/个人/会话 900/250/350 的估算 token 预算。按 observation ID、scope 和内容修订去重；原生压缩成功后开启新的注入边界。可选召回总等待最多 500ms，可取消，超时后不继续发起召回请求。Chat 不注册检查点工具或注入记忆提示。
- 产物仍检查存在性、文件边界和内容哈希。工作区与产物路径使用同一 canonical root，避免 macOS 路径别名造成误阻断。

## 验证

- `piNativeLongTask.integration.test.ts`：真实安装的 Pi SDK，离线可控 provider 响应。单次 prompt 完成 32 步真实文件写入，固定时钟下覆盖多次 threshold compaction 和 overflow compact-and-retry；结算只发生一次。压缩边界用例在旧补丁下失败、新补丁下通过。它证明执行/压缩接线，不证明真实模型推理质量或吞吐。
- `piPromptAppend.integration.test.ts`：使用真实 SDK 的资源加载和提示构建，验证 Work/Chat、重载及环境 SYSTEM.md 情况下，专家指令追加一次且原生工具指南完整保留。
- `piRuntimeAdapter.workQueue.test.ts`：应用 run 在压缩后续跑期间仍活动；成功压缩重置记忆去重，失败压缩不重置；没有 harness 额外提示。
- `taskService.approvals.test.ts`：并发审批、拒绝后不能复活、实际副作用不重复执行。
- `piSubagentTool.test.ts`：并行取消、排队任务不启动、子会话小窗口压缩预算。
- `piSkillScriptTool.test.ts`：运行中新增/移除 Skill 后，脚本执行权限及根目录即时生效。
- `memoryInjectionDedup.test.ts`、`memoryPromptRecall.test.ts`：重叠/重排/修订/跨 scope 记忆、多行内容、召回超时和取消。
- `artifactCollector.test.ts`：路径别名稳定重收集；越界中间文件仍拒绝。
- 流式守护和一致性测试继续约束增量 IPC、单点 coalescing、重同步和最终答复，不以删除完成门为由放松。

## Provider 回放限制

历史 `tests/piLongTaskReplay.test.ts` 在本轮开始前已整体 skip；本轮没有启用、改写磁带或放宽 seq/hash 匹配。改变 prompt 后的旧磁带不能证明新模型行为，真实质量对照须独立采集当前授权模型的输出、usage 和产物评分。不得用离线模拟声称真实模型效果已验收。
