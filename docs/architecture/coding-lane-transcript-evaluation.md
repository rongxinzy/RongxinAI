# Coding lane 事件投影 vs 直读 cowork transcript 评估（工作包 I.5 后半）

日期：2026-10-20 · 状态：评估完成，结论为不合并

## 问题

提示词 I.5 后半：「评估 lane 能否直接读 cowork transcript，不再复制一份进 `coding_events`」。内置（Pi）lane 的每个流事件都写入 `coding_events` 投影表，而同一会话的内容在 `cowork_messages` 里已有一份——表面上是一份数据两处存。

## 评估

**结论：不合并。`coding_events` 不是副本，而是 lane 的驱动无关（driver-agnostic）读模型。**

依据：

1. **lane 有两种驱动，只有一种有 transcript。** coding lane 同时支持 Builtin（Pi session）与 ACP（外部 agent，如 Claude Code CLI）驱动；ACP lane 的进程外事件流没有 cowork transcript 可读。若内置 lane 改读 transcript，读路径按驱动分叉成两套，UI 与 room 状态机也要分叉。
2. **投影带 transcript 没有的合并语义。** `appendOrMergeStreamEvent` 对 MessageDelta/ToolCall 按 `streamId` 在内存合并、节流落库（每块成本不随消息长度增长）；transcript 是逐消息终态存储，不承载增量流。
3. **状态机由事件到达驱动。** WaitingApproval / WaitingElicitation / Completed / TurnCancelled 等状态转换与事件同源记录（`updateLaneStatus` / `updateMissionStatus` / assignment 状态），且要跨进程重启存活（`hydrate` 后可继续合并先前的流行）。
4. **查询形态不同。** lane 视图按 `lane_id + sequence` 窗口分页（`codingEventWindowReader`），并派生 lane 工件记录（`recordCodingLaneArtifact`）；transcript 按会话消息分页。两边的分页/合并/派生逻辑都已在投影侧收敛。

## 已做的相关收敛

- #1243：运行时事件按会话精确路由（非 lane 会话零成本），elicitation / interruption 走会话快路径，不再全量 bootstrap room。
- #1244：lane 队列与控制命令层合并。

## 残余风险（记录在案）

- 存储双份的体积：流事件按窗口保留（窗口外由 reader 分页），lane 删除时 `coding_events` 随 room 级联清理（repository `DELETE ... WHERE lane_id IN ...`）。若未来体积成为问题，优先做的是投影压缩（只在窗口内保留 delta 合并行），而不是改读 transcript。
