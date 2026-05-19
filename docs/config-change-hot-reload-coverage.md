# 配置变更热重载覆盖分析

## 当前重启判定公式

```typescript
needsHardRestart = secretEnvVarsChanged
  || mcpBridgeForceRestart          // callbackUrl / tools changed
  || (syncResult.changed && options.restartGatewayIfRunning)  // 所有调用方都传 false
```

`bindingsChanged` 已从此公式移除（Phase 1）。实际应用中没有任何调用方传 `restartGatewayIfRunning: true`。

## 全场景覆盖表

### 无需重启（热重载） ✅

| 场景 | reason | 热重载方式 |
|------|--------|----------|
| **频道绑定变更** | `im-config-change` | 写文件 → config.apply RPC → Gateway hot → restartChannel（按粒度） |
| **Agent 创建/更新/删除** | `agent-created`, `agent-updated`, `agent-deleted` | 写文件 → config.apply RPC → Gateway hot → agents 运行时缓存失效 |
| **Agent preset 添加** | `agent-preset-added` | 同上 |
| **模型列表更新** | `server-models-updated` | 写文件 → config.apply RPC → Gateway hot → models 缓存失效 |
| **Skill 列表变更** | `skills-changed` | 写文件 → config.apply RPC → Gateway hot → tools/skills 热重载 |
| **会话策略更新** | `session-policy-updated` | 写文件 → config.apply RPC → Gateway hot → session 配置热应用 |
| **Cowork 配置变更** | `cowork-config-change` | 写文件 → config.apply RPC → Gateway hot |
| **应用配置变更** | `app-config-change` | 写文件 → config.apply RPC（主题/语言变更不触及 Gateway 敏感路径） |
| **Bootstrap 文件更新** | `bootstrap-updated` | 写文件 → config.apply RPC → SOUL/IDENTITY/USER.md |
| **Token 刷新** | `token-refresh` | 写文件 → config.apply RPC → TokenProxy 动态注入，免重启 |
| **IM 配对审批** | `im-pairing-approval:*` | 写文件 → config.apply RPC → Gateway hot |
| **系统代理变更** | `system-proxy-changed` | 写文件 → config.apply RPC → Gateway hot |
| **启动初始化** | `startup`, `bootstrap:*` | 写文件（Gateway 尚未运行，无 RPC 调用） |

### 必须重启 ❌

| 场景 | reason | 为什么不能热重载 |
|------|--------|----------------|
| **Provider API Key 变更** | `app-config-change`（密钥变更） | `secretEnvVarsChanged` 触发。env vars 在 `spawn()` 时固化到子进程，`${VAR}` 占位符由进程当前 env 解析。不 kill+spawn 则 Gateway 永远拿不到新密钥 |
| **MCP Bridge 配置变更** | `mcp-server-changed` | `mcpBridgeForceRestart` 触发。Gateway 在启动时固定 MCP Bridge callbackUrl，热重载无法更新回调地址 |
| **`restartGatewayIfRunning: true` 调用方** | — | 代码中**不存在**此调用方。所有 20+ 个调用方都传 `false` 或不传（默认 `false`） |

### 边缘场景

| 场景 | 行为 | 说明 |
|------|------|------|
| **IM Gateway Manager sync** | `im-gateway-sync`, `im-gateway-start:*` | 写文件 + `ensureOpenClawGatewayConnected()`。如果 bindings 变更包含在内 → Phase 1 免重启；如果触发 `secretEnvVarsChanged` → 仍重启 |
| **延迟重启执行** | `deferred:*` | 通过 `scheduleDeferredGatewayRestart` 排队，等 workload 空闲后执行。最终调用 `syncOpenClawConfig` 走相同判定逻辑 |
| **首次启动** | `ensureRunning:mcpBridge` | Gateway 尚未运行，只写文件不重启（`restartGatewayIfRunning: false`） |

## 热重载覆盖率

```
总调用场景:         ~23 个
无需重启:           ~21 个  (91%)
必须重启:           2 个    (secretEnvVarsChanged, mcpBridgeForceRestart)
已废弃:             0 个    (restartGatewayIfRunning: true 无调用方)
```

## 关键改进对比

### 改进前（main 分支）

```
needsHardRestart = secretEnvVarsChanged
  || syncResult.bindingsChanged    ← 每次切换频道 agent 都重启
  || mcpBridgeForceRestart
  || (syncResult.changed && options.restartGatewayIfRunning)
```

- 切换频道绑定 → **hard restart**（overlay 闪烁、3-5s 中断）
- 变更 Agent 配置 → 只看 `restartGatewayIfRunning`（都是 `false`，不重启）
- 模型/技能变更 → 同上，不重启

### 改进后（dev 分支）

```
needsHardRestart = secretEnvVarsChanged
  || mcpBridgeForceRestart
  || (syncResult.changed && options.restartGatewayIfRunning)
```

- 切换频道绑定 → **热重载**（config.apply RPC + chokidar，无中断）
- 变更 Agent 配置 → 热重载（config.apply RPC 即时推送）
- 模型/技能变更 → 热重载（同上）
- API Key 变更 → **hard restart**（物理限制，无法绕过）
- MCP Bridge 变更 → **hard restart**（Gateway 架构限制）

## 无法热重载的两个场景何时触发

| 场景 | 触发频率 | 用户感知 |
|------|---------|---------|
| `secretEnvVarsChanged` | 用户主动修改 API Key / Provider 密钥 | 极低频（设置一次后几乎不变） |
| `mcpBridgeForceRestart` | 首次配置 MCP Bridge 或修改其 callbackUrl/tools | 极低频（初始配置后几乎不变） |

高频场景（切换频道 agent、切换模型、更新技能）全部热重载免重启。
