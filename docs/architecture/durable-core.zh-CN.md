# Durable 执行内核

2026-11-14 起，应用直接使用 `@earendil-works/pi-durable@1.5.2`。旧 Coding Agent、agent-core、渠道桥接与外部记忆运行时已移除；旧数据原地弃置，不做迁移、读取或回退。

## 执行与存储

`durableSessionHost.mts` 安装原生 coding tools、应用工具、Skills/MCP 和记忆扩展，再打开 Harness。Work/Chat 经 `durableSession.mts` 提交原生 input；子智能体创建归属于当前原生 tool task 的 child conversation。模型请求、工具步骤、回执、重试、压缩和任务恢复均由 Durable 驱动。

每个产品会话对应 `userData/agent-runtime/<sha256(sessionId)>.sqlite`，包含结构化模型 transcript 和持久任务。应用 `zhiyuan.sqlite` 保存显示、工作台、权限及记忆治理投影，不能拿显示文本拼成新的模型历史。进程内限制同一文件只有一个 owner；关闭、显式失效及重开按顺序完成，避免删除仍打开的 SQLite/WAL。

`durableEventProjector.mts` 将原生已提交操作映射到现有 UI 协议，直接转发文本/思考 append delta。后续仍经过原有 translator、单点 coalescer、IPC、LiveTextStore。完整快照只用于原有异常恢复和终态，不增加第二个发送节流器。

## 自动化

`src/main/automations/` 的 ScheduleTask、RunTask、DeadlineTask 直接使用原生 Tasks、`sleepUntil`、稳定 requestId 与提交回执。任务定义、下次触发点及运行记录存在原生 Documents/entries；不存在 SQL Cron scheduler、轮询 clock、独立执行器或渠道投递器。`croner` 仅计算时区/DST 下的下一日期。

每个自动化使用同一桌面内核和独立执行库。可以连续使用任务上下文，或在每次执行前按原生上下文边界重置。停止当前模型轮次保留未来调度；停止自动化则原生撤销其活动/排队运行，再保留未来计划。应用退出使用 close 暂停，重开恢复既有提交，不另加一条用户指令。缺少工作区或模型时保留定义及 checkpoint，资源可用后重新挂载。

活动列表是显示投影。修改名称不改写过去的运行名称；删除定义保留已有历史。没有外部渠道或任意既有会话绑定。

自动化对话只展示运行记录，保留正文、附件、产物、导出和停止当前执行。输入、模型及权限变更通过自动化配置完成，主进程也拒绝普通聊天操作重建该会话。显式删除自动化对话会先撤销并卸载其任务，再关闭和清理执行库，避免留下失效的调度引用。

## 记忆

长期事实通过真实生态插件 `@sigrun/memory-markdown@0.3.1` 提供原生 sections、`memory_recall`、文件版本与整理能力。宿主只适配项目/个人作用域、候选确认、归档/过期及 SQLite 投影，不维护第二个全文索引。

可复现 vendor 包位于 `vendor/memory-markdown/`：Sigrun server peer 可选化，替换纯类型宿主声明，并修正 canonical 文件写入为同目录临时文件、flush、rename。其余五个上游 JS 字节不变。`node scripts/vendor-memory-markdown.mjs --verify` 校验来源、完整性与重现。普通会话不公开 curator-only `memory_write`；个人事实经用户确认才注入。不额外启动自动整理或隐藏模型回合。

Markdown 与应用 SQLite 不是单一事务；治理依靠既有 outbox/幂等标识重试。硬删除清理本 scope 的版本及暂存文件，不承诺清除既有审计 payload。

## 原生压缩与失败边界

保留 `pi-ai` 发送预算/overflow 补丁；`pi-durable-1.5.2-select-cut.patch` 修正 CJK 估算与切点无进展。小窗口模型的 keep/reserve/background 参数由统一 `durableCompactionPolicy` 配置，仍使用原生 CompactionTask。

提供方返回 `length` 时保留原生记录，但 UI 在终态前得知失败，不能误报完成。不追加外围总结、纠偏或无限续跑。摘要失败保留原始 journal；用户下一次明确输入可继续。远超单次摘要窗口且原生无法摘要的历史会明确失败，不伪造产物或压缩成功。

## 验证

- `durableSession*`：原生文件工具、结构化历史、关闭/恢复、显式取消和 owner 约束。
- `durableSubagent*`：真实 owned children、并发上限、取消子树、只读工具集、原生 child 工具活动。
- `piContextPressure` / `piOversizedResume` / `piNativeLongTask.integration`：真实本地 HTTP/SSE、中文独立 token 预算、32/48 文件证据、摘要失败后的继续与诚实终态。
- `automations/`：真实 SQLite、原生时钟、重启、并发停止、截止时间、上下文重置、重命名和资源缺失。
- `markdownMemory*`：真实插件/会话召回、跨 owner 隔离、确认/归档/过期、写入/rename 故障与 rename 前强杀。

这些协议与状态回归不等同于真实模型摘要质量或各平台安装包验收。发布前仍执行仓库规定的构建、原生依赖及安装检查。
