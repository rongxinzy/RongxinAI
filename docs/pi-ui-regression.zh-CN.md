# Pi UI 事件回归集

这组任务用于每次修改 Pi 运行时、主进程转发器、preload 或 Cowork Redux 后的真实 Electron 验收。它们必须使用开发版 Electron 和真实配置的模型端点执行，不能用 mock 响应代替。

## 启动

```bash
npm run electron:dev
```

分别在“工作”和“对话”模式执行下面的任务。权限选择“全部允许”，工作目录使用默认会话目录。每个任务都新建会话，等待终态后再执行下一个。

## 固定任务

| 编号 | 模式 | 输入 | 预期结果 |
| --- | --- | --- | --- |
| `plain-answer` | 工作 | `请只回复 PROTOCOL_OK` | 用户消息后出现一个 assistant 消息，最终完成；历史中没有重复的用户或 assistant 消息。 |
| `tool-success` | 工作 | `请用 bash 执行 pwd，并把结果原样回复。不要创建文件。` | UI 显示一次或多次工具调用，结果包含实际工作目录，最终完成；工作目录没有新增文件。 |
| `tool-recovery` | 工作 | `请用 bash 执行一个一定失败的命令 __zhiyuan_missing_command__，看到工具错误后继续，只回复 RECOVERED。` | 工具错误保留在轨迹中，模型继续完成并回复 `RECOVERED`；会话终态为完成而不是错误。 |
| `chat-pi-tool` | 对话 | `请用 bash 执行 pwd，只回复命令输出。不要创建文件。` | 对话模式也显示 Pi 工具调用和实际工作目录；不能出现“没有可用的 shell/终端环境”。 |

## 事件协议验收

主进程向渲染进程只发布 `cowork:stream:uiEvent` 作为 UI 事实源。每个事件必须包含：

- `protocolVersion: 1`
- 非空 `eventId`
- 每个 `sessionId` 独立递增的正整数 `sequence`
- 有限的 `emittedAt`

同一会话的允许终态转换由事件决定。初次启动时，Pi 适配器会先持久化并发布用户消息，随后收到 Pi 的 `agent_start`，所以实际序列允许先出现 `Message(user)`，再出现 `Started`；运行状态仍只能由 `Started` 建立：

```text
Message(user) -> Started -> Message / MessageUpdate / ToolActivity / PermissionRequest ...
       -> Completed
       -> Error
       -> Interrupted / Stopped
```

`Message` 到达不能把会话标记为运行中；运行中只能由 `Started` 事件建立，完成、错误、中断和停止只能由对应 Pi 事件结束。消息到达顺序不能用 renderer 的时间戳或当前状态重新推断。

已删除旧的拆分流式 IPC 通道；`cowork.ts` 和 `coworkQueue.ts` 只监听统一事件。启动和续聊的异步失败也通过运行时错误监听器持久化，再按消息、错误的顺序发布统一事件。

旧 renderer API 聊天服务及其专属搜索、重试和流式请求辅助模块已删除。设置保存仍通过配置服务生效，模型能力探测保留独立入口。会话与完成事件只使用产品会话 ID，不再携带旧 SDK 会话 ID；新数据库不创建旧列，既有数据库中的旧列不再读写且不主动删除。执行模式由共享常量限定为 `auto / local`，IPC 拒绝已移除的运行模式。

## Chat 身份追加路径验证

`piPromptAppend.integration.test.ts` 直接使用已安装 Pi SDK 的 `DefaultResourceLoader` 和 `buildSystemPrompt`，验证追加身份后默认提示词及工具规则完整保留、非空覆盖会跳过默认规则、重复 reload 不重复追加，以及自动发现 `SYSTEM.md` 时需要显式返回 `undefined` 才能保留默认提示词。测试使用隔离临时目录，不调用模型；它验证提示词合成行为，不等同于真实对话或模型遵循身份的验收。生产 Chat 身份注入尚未启用。

## 运行状态恢复回归

`cowork:stream:runtimeSnapshots` 返回主进程从 Pi 生命周期事件维护的状态和事件序号，不从数据库的 `running` 字段推断是否正在执行。渲染监听器接入时读取快照；首次收到大于 1 的序号或后续出现序号缺口时，后台补读会话。补读不改变当前会话、工作区、智能体、技能、草稿或未读状态。

自动化回归位于 `cowork.runtimeRecovery.test.ts`、`piUiRecovery.test.ts`、`piUiRuntimeSnapshot.test.ts` 和 `piUiEvent.test.ts`，覆盖：

- Started 已发生且运行时暂时不再发送事件时，重新接入仍恢复运行指示。
- 首个 Started 丢失后，通过下一个事件恢复运行状态。
- Completed 丢失后，通过序号缺口清除运行状态和旧 live snapshot。
- 后台会话补同步不触发页面导航或清除用户选择。
- 旧快照不覆盖新的 Started/Completed，同步期间的新文本及已加载旧历史得到保留。
- 重复缺口合并执行，销毁监听器后不再应用未完成请求。

真实 Electron 复验时，额外执行长任务期间重新加载渲染进程，确认运行指示及停止按钮恢复并可停止任务。自动化测试不代替这项实机验收。

## 记录

2026-09-22 开发版真实验收：

- `plain-answer`：通过，完成态和历史顺序正常。
- `tool-success`：通过，工作模式显示 Pi 工具调用并返回 `/Users/krli/.zhiyuan/scratch`。
- `tool-recovery`：通过，确定失败命令后继续回复 `RECOVERED`。
- `chat-pi-tool`：通过，对话模式显示 1 次思考、1 次工具调用并返回 `/Users/krli/.zhiyuan/scratch`。

这份记录只证明当前开发机、当前模型配置和当前 checkout 的行为；提交前仍需重新执行整组任务。
