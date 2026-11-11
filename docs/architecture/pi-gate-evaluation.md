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
- `piCompactionUsageBoundary.integration.test.ts`：真实安装 SDK，公开 `session.prompt` 路径和离线 provider。覆盖 stop/error 的零 usage 回退、压缩后同毫秒/较晚的新 usage、压缩前保留的旧 usage。阈值估算使用会话记录顺序判断来源是否仍有效；同毫秒两项在旧补丁下失败，修复后六项通过。这只证明该压缩边界遗漏，不证明真实 32/48 文档任务质量或其失败根因。
- `piPromptAppend.integration.test.ts`：使用真实 SDK 的资源加载和提示构建，验证 Work/Chat、重载及环境 SYSTEM.md 情况下，专家指令追加一次且原生工具指南完整保留。
- `piRuntimeAdapter.workQueue.test.ts`：应用 run 在压缩后续跑期间仍活动；成功压缩重置记忆去重，失败压缩不重置；没有 harness 额外提示。
- `taskService.approvals.test.ts`：并发审批、拒绝后不能复活、实际副作用不重复执行。
- `piSubagentTool.test.ts`：并行取消、排队任务不启动、子会话小窗口压缩预算。
- `piSkillScriptTool.test.ts`：运行中新增/移除 Skill 后，脚本执行权限及根目录即时生效。
- `memoryInjectionDedup.test.ts`、`memoryPromptRecall.test.ts`：重叠/重排/修订/跨 scope 记忆、多行内容、召回超时和取消。
- `artifactCollector.test.ts`：路径别名稳定重收集；越界中间文件仍拒绝。
- 流式守护和一致性测试继续约束增量 IPC、单点 coalescing、重同步和最终答复，不以删除完成门为由放松。

## 真实复测后的确定性修复

真实 32 文档复测出现最终 `length`、产物缺失但仍收到 `complete`，不能据离线 SDK 测试认定长任务稳定。后续修复将执行终止与业务验收区分：只在原生恢复全部结束后检查最终响应；仍截断、取消或停在工具调用时报告中断，不借用更早的正常回答完成。验收返回 Failed 时发出错误，不再因 Promise 正常返回就发出 complete；正常 complete 的内部事件携带 Passed/AcceptanceRequired 验收结果，后者不代表业务成功。

实时和回放驱动共用任务专属产物检查：全部文档摘要与索引的数量、顺序、四列 CSV，以及报告至少 1500 个汉字。检查仅属于测试，不向运行时注入固定产物协议；严格回放的 seq/hash 规则不变。

录制代理逐块转发响应，保留背压；客户端断开会取消上游请求，连接重置得到受控失败，不再产生未处理的异步拒绝。只录制完整响应，半截响应不作为成功磁带保存。

新增真实适配器＋真实 SDK＋本地 HTTP/SSE 测试区分最终 length 和 stop；此用例只替代未编译的产物 worker 执行其真实空目录 collector，不替代执行内核或 HTTP 解码。另有适配器恢复/截断、验收失败、代理首块实时性/断开/重置及不完整产物的定向回归。

本轮全量单测 6155 项通过、84 项既有跳过；生产构建、主进程类型检查、lint、Knip、格式检查通过（lint 保留 282 条既有警告，Knip 保留三项配置提示）。Electron 44.9.3 主进程使用隔离 userData、真实 SQLite、真实 SDK、编译后的产物 worker 和本地 HTTP 响应复验：最终 length 发出一次 StreamInterrupted、零次 complete；正常 stop 发出一次 complete，验收结果 Passed。测试实例已退出，结果位于 `/tmp/pi-terminal-electron-result.json`。

真实复测中自动压缩未触发的根因仍待定位。本轮不以修改阈值、扩大窗口或新增 harness 补跑掩盖它；未进行新的真实模型 32/48 文档验收。

## Provider 回放限制

历史 `tests/piLongTaskReplay.test.ts` 在本轮开始前已整体 skip；本轮没有启用、改写磁带或放宽 seq/hash 匹配。改变 prompt 后的旧磁带不能证明新模型行为，真实质量对照须独立采集当前授权模型的输出、usage 和产物评分。不得用离线模拟声称真实模型效果已验收。
