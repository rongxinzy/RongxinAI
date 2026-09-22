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

旧的拆分 IPC 通道暂时只为兼容遗留投影和非主 UI 消费者保留；`cowork.ts` 和 `coworkQueue.ts` 的主 UI 路径只监听统一事件。

## 记录

2026-09-22 开发版真实验收：

- `plain-answer`：通过，完成态和历史顺序正常。
- `tool-success`：通过，工作模式显示 Pi 工具调用并返回 `/Users/krli/.zhiyuan/scratch`。
- `tool-recovery`：通过，确定失败命令后继续回复 `RECOVERED`。
- `chat-pi-tool`：通过，对话模式显示 1 次思考、1 次工具调用并返回 `/Users/krli/.zhiyuan/scratch`。

这份记录只证明当前开发机、当前模型配置和当前 checkout 的行为；提交前仍需重新执行整组任务。
