# 待发消息队列统一评估（工作包 I.4）

日期：2026-10-20 · 状态：验证完成，方案待用户定夺

## 问题

待发消息队列有两份实现：

1. **Work/Cowork 队列**：`agentEngine/piPendingMessageQueue.ts` + `piRuntimeQueueController.ts`（合计约 500 行）。入队时消息停在应用侧，`agent_settled` 后由 `flushFollowUpQueue` 取出并以 `sendPiPrompt` 另起新回合投递。
2. **Coding lane 队列**：`codingAgent/codingRoom/builtinControlCommands.ts`（原 `pendingMessageQueue.ts` 层，已合并）。ACP lane 的 follow-up 排队与投递，语义独立。

## Pi 原生能力（已对 `@earendil-works/pi-coding-agent` 的 `AgentSession` 声明验证）

- `prompt(text, { streamingBehavior: 'steer' | 'followUp' })`：流式期间入队，由 Pi 在**同一 run 内**续投——steer 在当前助手回合的工具调用执行完后、下一次 LLM 调用前送达；followUp 按序等待。
- `steer(text, images?)` / `followUp(...)`：显式入队接口。
- `clearQueue(): { steering: string[]; followUp: string[] }`：**批量**取回（用于中止时还原编辑器）。
- `getSteeringMessages()` / `getFollowUpMessages()` / `pendingMessageCount`：只读列表。
- **没有**逐条删除、逐条改写、逐条失败记录的 API。

## 结论

「投递时机交给 Pi 原生 followUp()/steer()，同一 run 内续上」**技术可行**（原生接口齐备）。但两份队列的存在不只是投递时机：

应用侧队列还承担——① 挂起期逐条**编辑/删除**（`updatePendingMessage` / `deletePendingMessage`）；② 逐条**失败记录与重试**（`Failed` 状态 + error）；③ FollowUp→Steer 的逐条**升级**；④ skill 附加与图片/文件附件的合并投递；⑤ IM/Channel/Cron 的「结算后投递」语义对齐；⑥ 控制命令排在 prompt 之后的应用侧排序。

一旦入队即交给 Pi，①②③ 因原生 API 只有批量 `clearQueue` 而失去逐条能力——这是可见 UX 回退（用户当前可在挂起列表里编辑/删除单条）。

## 备选方案

- **方案 A（原生投递 + 应用侧影子列表）**：入队时即调 `piSession.followUp()`，应用侧保留影子列表用于展示，`getFollowUpMessages()` 对账；编辑/删除仅支持「清空全部并重排」（clearQueue + 重新入队），逐条编辑/失败记录取消。
- **方案 B（维持现状，仅去掉 coding lane 重复）**：Work 队列保持应用侧持有 + 结算后投递；coding lane 队列评估并入 Work 队列（lane 与 Work session 同为 Pi session，队列语义相同，重复实现可以合并）。
- **方案 C（混合）**：投递走原生 `streamingBehavior: 'followUp'`，但仅对「入队后未被编辑过」的消息；编辑过的保留应用侧结算后投递。复杂度最高，不建议。

**建议：方案 B**。收益/风险比最好：消除真实重复（lane 队列），不牺牲逐条编辑 UX；方案 A 的收益（少一层投递簿记）小于其 UX 回退与对账复杂度。方案 A 仅在产品决定放弃挂起期逐条编辑时才值得。

## 已完成的相关清理

- lane 队列与控制命令层已合并（#1244），`recordBuiltinElicitation` / `recordBuiltinInterruption` 已有会话快路径（#1243）。

## 待用户确认

1. 方案 A/B/C 的取舍（涉及挂起消息「逐条编辑/删除」UX 的去留）。
2. 若选 B：lane 队列并入 Work 队列的实现优先级。
