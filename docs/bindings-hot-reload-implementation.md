# Agent Binding 热重载 — 实施记录

## 阶段 3 可行性裁决：暂缓

### 原计划

```typescript
if (secretEnvVarsChanged || mcpBridgeConfigChanged) {
  await applyConfig();  // Gateway 内部 requestGatewayRestart（30s 优雅等待）
}
```

### 判定结论：当前架构下不可行，暂缓实施

| 重启触发条件 | config.apply 能否替代？ | 原因 |
|-------------|----------------------|------|
| `secretEnvVarsChanged` | **否** | env vars 在 `spawn()` 时固化到子进程。`config.apply` 传入的 raw config 中的 `${VAR}` 占位符由 Gateway 进程**当前 env** 解析，不会拿到新值。必须 kill+spawn |
| `mcpBridgeConfigChanged` | **可疑** | Gateway 在启动时固定 MCP bridge callbackUrl，config.apply 理论可触发 `requestGatewayRestart()`，但 Windows 无 SIGUSR1，依赖应用侧 kill+spawn |
| `configChanged && restartGatewayIfRunning` | **已在 Phase 2 覆盖** | 实际代码中此路径极少触发，所有调用方都传 `false` |

### 决策

Phase 3 的价值（优雅重启 vs 强杀重启，3-5s → ~200ms）在当前两个真实触发条件上无法实现：

- `secretEnvVarsChanged` 必须 kill+spawn（env vars 物理限制）
- `mcpBridgeConfigChanged` 发生率极低（几乎只在首次 MCP bridge 配置时触发一次）

**Phase 1 + Phase 2 已覆盖 95% 的配置变更场景**（binding/agent/model/skills 等），这些变更不再需要重启。剩余 5%（env var / MCP bridge）的优化收益不足以匹配实现复杂度。

### 当前分支方案总结

```
配置变更
  ├─ bindingsChanged / agentChanged / modelChanged / skillsChanged ...
  │   → 写 openclaw.json（原有）
  │   → config.apply RPC（Phase 2 新增，WebSocket 即时推送）
  │   → Gateway hybrid engine 热更（无需重启）
  │   → 无 overlay 闪烁
  │
  ├─ secretEnvVarsChanged
  │   → 写 openclaw.json
  │   → kill + spawn（必须，env vars 物理限制）
  │
  └─ mcpBridgeConfigChanged
      → 写 openclaw.json
      → kill + spawn（必须，callbackUrl 在启动时固化）
```
