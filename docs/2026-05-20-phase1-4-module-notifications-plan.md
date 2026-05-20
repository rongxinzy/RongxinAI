# Phase 1.4: 跨模块通知机制 — 实施计划

日期：2026-05-20

## 目标

填补 main process 中 ~6 个跨模块通知缺口，采用显式方法调用而非通用事件总线。

最终输出：网关断连时 IM 主动暂停、会话结束时触发记忆后台更新、定时任务完成时自动刷新 UI、引擎状态变化时统一通知所有关注方。

## 范围判定

### 在范围内

| # | 通知 | 发布者 | 订阅者 | 方式 |
|---|------|--------|--------|------|
| 1 | 网关断连 | openclawRuntimeAdapter | IMGatewayManager | 回调注册 |
| 2 | 网关重连 | openclawRuntimeAdapter | IMGatewayManager | 回调注册 |
| 3 | 引擎状态变化 | openclawEngineManager | IMGatewayManager, cronJobService | 现有 EventEmitter 扩展 |
| 4 | 会话结束 | CoworkEngineRouter | 记忆系统 | 现有 error/complete 事件复用 |
| 5 | 定时任务完成 | cronJobService | renderer | 通过现有 IPC Refresh 通道 |
| 6 | 记忆变更 | CoworkStore | renderer | 通过现有 sessions:changed 通道 |

### 不在范围内

- 通用 DomainEventBus 框架
- renderer 内部事件（继续使用 Redux）
- main↔renderer 跨进程通信机制改造（继续使用 IPC）
- 持久化事件日志

## 实施步骤

### Step 1: openclawRuntimeAdapter 添加网关断连/重连回调

- 添加 `onGatewayDisconnect` / `onGatewayConnected` 回调注册
- 在 WebSocket `close` 事件处调用 `onGatewayDisconnect`
- 在 WebSocket 重连成功后调用 `onGatewayConnected`

### Step 2: IMGatewayManager 添加生命周期方法

- 添加 `onOpenClawDisconnected(reason)` — 暂停活跃网关
- 添加 `onOpenClawConnected()` — 恢复并重连网关

### Step 3: main.ts 串联断连通知

- `openclawRuntimeAdapter.onGatewayDisconnect` → `imGatewayManager.onOpenClawDisconnected`
- `openclawRuntimeAdapter.onGatewayConnected` → `imGatewayManager.onOpenClawConnected`

### Step 4: 引擎状态变化统一通知

- `openclawEngineManager` 状态变化时通知 IMGatewayManager
- 复用现有 `onProgress` 机制

### Step 5: 会话结束 → 记忆系统触发

- 在 `CoworkEngineRouter` error/complete 事件中触发记忆后台更新
- 利用现有 `openclawMemoryFile` 和 CoworkStore

### Step 6: 定时任务完成 → UI 自动刷新

- 在 `cronJobService` 任务完成时发送 `ScheduledTaskIpc.Refresh` IPC 事件
- renderer 已有对应的 `onRefresh` 监听器

## 文件变更范围

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/main/libs/agentEngine/openclawRuntimeAdapter.ts` | 修改 | 添加 onGatewayDisconnect/Connected 回调 |
| `src/main/im/imGatewayManager.ts` | 修改 | 添加 onOpenClawDisconnected/Connected 方法 |
| `src/main/main.ts` | 修改 | 串联断连通知 + 引擎状态通知 |
| `src/main/ipcHandlers/scheduledTask/cronJobServiceManager.ts` | 修改 | 任务完成时触发 IPC Refresh |

## 验收标准

- [ ] 网关断连时 IMGatewayManager 收到通知并暂停网关
- [ ] 网关重连时 IMGatewayManager 收到通知并可恢复
- [ ] 任务完成时 renderer scheduled task 列表自动刷新
- [ ] TypeScript 编译通过
- [ ] 现有测试通过
