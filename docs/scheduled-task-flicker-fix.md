# 定时任务完成时当前会话窗闪烁问题 — 诊断与修复

## 问题现象

在开发者模式下，当定时任务（scheduled task）在后台完成时，当前正在查看的会话窗口会发生闪烁（类似刷新的视觉效果）。

## 根源分析

### 完整事件链路

```
1. 定时任务 Agent turn 完成（Session B）
   ↓
2. openclawRuntimeAdapter.ts:3564 调用 reconcileWithHistory(sessionId_B, sessionKey)
   ↓
3. reconcileWithHistory (line 4257) 调用 store.replaceConversationMessages()
   全量替换 Session B 的消息（SQLite bulk replace）
   ↓
4. line 4263: 向所有 BrowserWindow 广播 cowork:sessions:changed（无 sessionId）
   ↓
5. 渲染进程 cowork.ts:172 onSessionsChanged handler 被触发：
   a. loadSessions() → dispatch(setSessions) → sessions 数组完全替换（新引用）
   b. loadSession(currentSessionId_A) → dispatch(setCurrentSession)
      → currentSession 对象完全替换（新引用）
   ↓
6. CoworkSessionDetail 因 currentSession 引用变化完全重渲染
   → buildDisplayItems / buildConversationTurns 重新计算
   → 视觉上表现为「闪烁/刷新」
```

### 核心问题

`onSessionsChanged` 处理器**无条件**调用 `loadSession(currentId)`。当定时任务在 **Session B** 中完成时，当前正在查看的 **Session A** 数据完全没有变化，但 `setCurrentSession` 仍然创建了全新的 `currentSession` 对象引用，触发整个对话视图的完整重渲染。

### 其他加剧因素

| 因素 | 位置 | 影响 |
|------|------|------|
| `cowork:sessions:changed` 不携带 sessionId | 4 处 IPC 发送点 | 渲染进程无法判断哪个 session 变了 |
| Window focus 无条件 reload | `CoworkView.tsx:435-447` | 开发时切到 DevTools 再切回来触发 `loadSession()` |
| 轮询间隔叠加 | `cronJobService.ts` 15s + `openclawRuntimeAdapter.ts` 10s | 多个事件可能同时触发 |
| `setCurrentSession` 无幂等性检查 | `coworkSlice.ts:129-157` | 数据完全相同时也创建新引用 |

## 修复方案

### 1. IPC 事件携带 sessionId

**涉及文件：**
- `src/main/preload.ts` — 转发 IPC 数据到渲染进程回调
- `src/main/libs/agentEngine/openclawRuntimeAdapter.ts` — `reconcileWithHistory` 和 `deleteAssistantMessage`
- `src/main/libs/openclawChannelSessionSync.ts` — agent 绑定变更时的 session 创建
- `src/renderer/types/electron.d.ts` — 更新类型签名

`cowork:sessions:changed` 事件现在携带 `{ sessionId?: string }` 参数。

- `reconcileWithHistory` 传入受影响的 `sessionId`
- `deleteAssistantMessage` 传入受影响的 `sessionId`
- `openclawChannelSessionSync` 传入新创建的 `newSession.id`
- `pollChannelSessions`（多 session 发现场景）保持不传 sessionId，触发向后兼容的完全刷新

**向后兼容：** 不传 sessionId 时，渲染进程行为与修复前一致（无条件 reload 当前 session）。

### 2. 渲染进程仅 reload 受影响的 session

**文件：** `src/renderer/services/cowork.ts`

```typescript
// 仅在 changedSessionId 为空(向后兼容) 或匹配当前 session 时才 reload
if (!changedSessionId || changedSessionId === currentId) {
  void this.loadSession(currentId);
}
```

当定时任务在 Session B 完成时，`changedSessionId = B`，而 `currentId = A`，不匹配 → 跳过 `loadSession(A)` → 无闪烁。

### 3. setCurrentSession 幂等性守卫

**文件：** `src/renderer/store/slices/coworkSlice.ts`

在创建新 `currentSession` 对象之前，进行 O(1) 指纹比较：
- 消息数量是否相同
- 首尾消息 ID 是否相同
- status、title、messagesOffset、totalMessages 是否相同

如果所有字段均匹配，直接 `return` 跳过 Immer 变更和下游状态更新。

### 4. Window focus handler 去抖

**文件：** `src/renderer/components/cowork/CoworkView.tsx`

添加 2 秒 debounce，防止频繁 Alt+Tab 切换（如在 DevTools 和主窗口之间）时重复调用 `loadSession`。

## 架构收益

1. **精准更新**：只有当前查看的 session 数据确实变化时才重渲染
2. **零额外开销**：幂等性检查是 O(1) 的，不随消息数量增长
3. **向后兼容**：不传 sessionId 的调用方保持原有行为
4. **防御性设计**：多层防护（事件层 + reducer 层 + 去抖层）确保即使某一层失效也不会闪烁

## 验证方法

1. 在 Session A 中查看对话时，定时任务在 Session B 完成后 → Session A 不应闪烁
2. 在 Session B 中查看对话时，定时任务在 Session B 完成后 → Session B 应正常更新
3. 在 session running 时频繁切换 DevTools → 不应触发无意义的 reload
4. 侧边栏正常显示新发现的 channel sessions
5. Console log 中可看到 `changedSessionId` 确认 IPC 数据传递正确
