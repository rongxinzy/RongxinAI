# Cowork 流式输出（Streaming）

**本文档待补。** 现行实现与基准测试将在 [PR #1119](https://github.com/rongxinzy/RongxinAI/pull/1119) 合入后在此说明。

在此之前，仅保留事实边界：

- Work/Chat 会话流由主进程 Pi 运行时经 IPC 推到渲染进程，再进入 Redux 与 Cowork UI。
- 增量正文路径仍经 `CoworkContentProjection` 与 worker prefix diff（非 #1115 改造范围）；勿在其它文档中臆造帧大小、截断阈值或事件名细节。

相关代码入口（不含流式细节）：`src/main/libs/agentEngine/piRuntimeAdapter.ts`、`src/renderer/services/cowork.ts`。
