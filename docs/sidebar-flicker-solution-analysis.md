# 侧边栏重渲染导致对话窗口闪烁 — 方案分析

## 问题本质

```
state.sessions 或 state.unreadSessionIds 引用变更
  → Sidebar.tsx:useSelector(selectCoworkSessions) 或
    useAgentSidebarState:useSelector(selectUnreadSessionIds) 检测到
  → 侧边栏整树重算 + React 协调
  → Flexbox 布局重算 + 浏览器 Paint
  → 相邻 CoworkView 区域感知为闪烁
```

## 当前已实施的修复

| 层 | 文件 | 做法 | 问题 |
|----|------|------|------|
| 1 | `coworkSlice:updateSessionStatus` | 非当前会话不碰 `state.sessions` | `updatedAt`/`status` 数据滞后 |
| 2 | `coworkSlice:addMessage` | 非当前会话不碰 `state.sessions` | 同上 |
| 3 | `useAgentSidebarState:useDeferredValue` | 未读标记更新降级为非紧急渲染 | 治标，仍有帧延迟 |

层 1/2 的问题是**数据正确性被牺牲**——`state.sessions` 中非当前会话的 `status` 和 `updatedAt` 不再实时更新，任何依赖这些字段的组件都拿到的是旧数据。

## 方案矩阵

### 方案 A：CSS Containment（隔离布局）

```css
.cowork-view-container {
    contain: layout style;
}
```

| 维度 | 评价 |
|------|------|
| 可行性 | ⭐⭐⭐⭐⭐ 极高（一行 CSS） |
| 效果 | 告诉浏览器：此元素内部布局变化不影响外部，外部变化也不影响内部。侧边栏随便重渲染，对话区不重绘 |
| 弊端 | React 仍会执行 JS 协调（虚拟 DOM diff），只是浏览器跳过 Paint 和 Layout。CPU 消耗不变 |
| 侵入性 | 零 |

### 方案 B：自定义 equality 保持数据 + 阻止重渲染

```typescript
const sessions = useSelector(selectCoworkSessions, (prev, next) =>
    prev.length === next.length &&
    prev.every((s, i) => s.id === next[i].id)
);
```

| 维度 | 评价 |
|------|------|
| 可行性 | ⭐⭐⭐⭐ 高 |
| 效果 | `state.sessions` 照常更新（数据正确），但 Sidebar 仅在 session 新增/删除/排序变化时重渲染。`updatedAt`/`status` 变更被忽略 |
| 弊端 | 侧边栏显示的 `status` 和排序（基于 `updatedAt`）会滞后到下次 `loadSessions()` |
| 侵入性 | 低（改 1 个 selector） |

**与当前方案的关键区别**：数据层保持正确（可回退当前层 1/2 的 "skip mutation" hack），只在视图层过滤。

### 方案 C：未读标记用 Set 结构（无新引用）

**用户原话**："让 unreadSessionIds 通过指针处理数组，而非返回新数组"

Redux Toolkit + Immer 的限制：**任何 draft 上的属性变更都会产生新引用**。即使把 `unreadSessionIds` 从数组改成 `Set` 或 `Record<string, boolean>`：

```typescript
// 改成 Set
state.unreadSessionIds.add(sessionId);     // Immer → 新 Set 引用
// 改成 Record
state.unreadSessionIds[sessionId] = true;   // Immer → 新对象引用
```

无法绕过。要"指针不变"，只能用 `useRef` 在 React 侧拦截：

```typescript
const unreadSessionIds = useSelector(selectUnreadSessionIds);
const stableRef = useRef(unreadSessionIds);
if (!shallowEqual(unreadSessionIds, stableRef.current)) {
    stableRef.current = unreadSessionIds;  // useRef 不会触发重渲染
}
// stableRef.current 是旧值，未读标记不更新 ❌
```

**结论**：不可行。useRef 不触发重渲染 → 未读标记永远不会出现。

### 方案 D：双 BrowserWindow（独立渲染目标）

| 维度 | 评价 |
|------|------|
| 可行性 | ⭐ 极低 |
| 效果 | 两个独立 renderer process，完全隔离 |
| 弊端 | 整个 App.tsx 布局需拆成父子窗口 IPC 通信、焦点管理、跨窗口拖拽、macOS 无边框窗口都需重新实现 |
| 侵入性 | 极高 |

**结论**：杀鸡用牛刀，不可行。

### 方案 E：React Portal + 独立 createRoot

```typescript
// 侧边栏用独立 React root
const sidebarRoot = createRoot(document.getElementById('sidebar-root'));
sidebarRoot.render(<SidebarTree sessions={sessions} />);

// 对话区用另一个 root
const chatRoot = createRoot(document.getElementById('chat-root'));
chatRoot.render(<CoworkView />);
```

| 维度 | 评价 |
|------|------|
| 可行性 | ⭐⭐⭐ 中 |
| 效果 | 两个 root 有独立的 fiber tree 和渲染调度，互不阻塞 |
| 弊端 | 共享数据需通过 props/context 传递或事件总线；两个 root 不能用同一个 Redux Provider（需各自订阅）；App.tsx 需大改 |
| 侵入性 | 高 |

### 方案 F：Web Worker 卸载侧边栏计算

侧边栏树计算（`useAgentSidebarState` 的 `useMemo`）移到 Web Worker，主线程只做渲染。

| 维度 | 评价 |
|------|------|
| 可行性 | ⭐⭐ 低 |
| 效果 | 主线程不阻塞 |
| 弊端 | Redux store 无法在 Worker 中访问；需要序列化/反序列化树数据；调试困难 |
| 侵入性 | 高 |

## 推荐组合方案

```
高强度防护：方案 A（CSS contain） + 方案 B（自定义 equality）
低强度防护：方案 A（CSS contain） + 现有 useDeferredValue
```

**推荐实施**：先回退当前层 1/2 的 "skip mutation" hack，恢复 `state.sessions` 数据正确性，再加：

1. CSS `contain: layout style` 在 CoworkView 容器上（阻断 Paint 传播）
2. `useSelector` 自定义 equality 在 `selectCoworkSessions` 上（阻断 JS 协调传播）
3. 保留 `useDeferredValue` 在 `selectUnreadSessionIds` 上（降低未读标记优先级）

这样数据层完全正确（`state.sessions` 实时反映所有会话状态），视图层通过 CSS + selector equality 两重隔离避免闪烁。
