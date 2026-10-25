# 伙伴任务记忆隔离阶段记录

2026-10-25。复用现有 Pi、Engram、SQLite 投影、outbox 和个人记忆确认机制，没有增加依赖或第二套执行框架。完整范围保留在[产品清单](intelligent-companion.md)。本阶段只覆盖任务记忆与历史归属，不表示完整产品已完成。

## 行为

- 任务受理事务中的 `companion_task_admissions` 是伙伴归属的事实来源。会话索引唯一；选中伙伴、换装、从工作台续办和进程重开不改写受理记录。模型参数不包含可替换归属的 `petId` / `sessionId`。
- 初次任务和续办复用现有记忆上下文路径。原有 900/250/350 token 预算分别用于所属伙伴事实、已确认个人事实和当前任务摘要，不重复注入另一份个人记忆。任务系统提示不存放事实快照；已经进入对话的内容仍属于历史，不承诺遗忘会擦除旧对话。
- `memory` 的检索、列表、观察 ID 引用、显式保存和个人提议按受理伙伴解析。显式保存进入同一个伙伴私有命名空间，聊天管理入口可见；离线保存先建立候选，再经既有 outbox 同步，可以撤回或在远端写入期间删除，回执不能恢复已撤回内容。
- 任务验证产生的候选也进入所属伙伴范围，保留 Task/Run 等来源，不因验证通过自动共享。个人提议仍经用户确认；跨伙伴引用来源不能被提升为个人事实。
- 任务摘要仍使用 Session 范围与既有过期规则，但命名空间属于伙伴，召回还须匹配原任务会话。普通工作台全局记忆列表和全局摘要回填不消费这些私有记录。普通工作台新任务继续使用原项目、个人与会话记忆。
- `conversation_history` 由宿主绑定当前执行会话。伙伴任务只搜同一伙伴、同一项目中的任务对话；普通任务只搜普通对话。归属条件在 SQL 的数量限制之前应用，精确及关键词回退均受约束。工作台手动打开原任务仍可查看和继续同一 Task/Run。

## 发现并修复的检索问题

真实 Electron 验收中，“整理项目资料，继续完成。”没有召回刚加入的事实。真实 Engram 单测复现后发现：查询规划把中文分词重新拼接比较，词边界改变而字母未变时，误判无需关键词回退。现保留分词边界，精确检索无结果后执行原有关键词回退；没有新增最近事实兜底或降低断言。

## 证据

- `bunx vitest run src/main/conversationHistory src/main/companion src/main/memory src/main/libs/agentEngine/piRuntimeAdapter --maxWorkers=2`：48 文件、357 项通过。包含真实 SQLite/Engram 的聊天到任务召回、任务工具保存、遗忘、离线撤回、在途删除、摘要范围、个人确认，以及历史查询在大量无权结果下仍返回可见内容、宿主参数不能被工具输入覆盖、重开数据库后归属保留。
- 真实 Electron / macOS arm64 / DPR 2，独立临时用户目录、真实 Magpie 与 Engram、本机 SSE：初次任务召回 A 私有事实，普通权限卡批准 `memory` 保存；切换到 B 后由工作台续办 A 的任务，召回 A 在首轮后新增的事实；B 新任务只召回 B 事实；普通记忆管理没有这些私有记录。4 次业务模型请求（含工具往返与续办）、6 次既有记忆维护，共 10 次请求。没有调用真实账号模型，不能证明模型选择保存内容的质量。
- 复跑：先 `bun run build:electron:dev`，启动预览，再执行 `PREVIEW_PORT=5194 COMPANION_VERIFY_TASK_MEMORY=1 bun scripts/companion/verify-task-electron.mjs`。结构化结果见[原生结果](../companion-task-memory-2026-10-25/native.json)。原始目录 `/tmp/companion-task-native-h8XYBa`，工作区 `/tmp/companion-task-workspace-th8uhz`。
- 主进程类型、生产构建、常规/生产 Knip、lint、格式、源码行数和包体预算通过。启动图 112 文件 / 1.76 MiB，preload 31 文件 / 0.87 MiB。常规 Knip 仍有三项既有配置提示，lint 和构建仍有无关存量警告，不称清零。
- 日志：`/tmp/companion-task-memory-{regression-accepted,native-final,types-final,build,knip-final,knip-production,lint-final,format-final,lines,budget}.log`。本阶段未改渲染器、主题、预览契约或用户界面布局，不将此前浏览器截图当作本阶段重新进行的 UI 验收。

## 失败记录与未完成项

首轮受限环境禁止监听 127.0.0.1，确认 EPERM 后终止该测试进程，在允许本机回环的环境复跑。首轮原生脚本没有批准权限卡，90 秒超时；后补正常工作台批准操作，未改权限规则。第二轮原生检查捕获中文续办缺少新事实，补真实回归并修复检索后通过，未放宽超时或断言。受限环境 Knip 因 Vite 配置生成 worktree 构建文件返回 EPERM，允许写入后原命令通过。

私有任务候选的管理确认入口、聊天中的自然语言记忆管理、真实模型质量、整个原生应用退出重开后的端到端验收、大量记忆及长时资源验收仍待完成。Windows 窗口互动、主动跟进、剩余产品文案和最终美术按总清单继续；本阶段不等于 PR 合并或发版。
