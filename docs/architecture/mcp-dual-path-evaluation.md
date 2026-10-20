# MCP 双路径收敛评估（工作包 H）

日期：2026-10-20 · 状态：问题验证完成，统一实现待设计轮次与对比数据

## 现状（已核实）

两条 MCP 接入路径：

1. **网关工具路径**（普通会话）：`mcpBootstrap.initMcpServers` → `mcpServerManager.startServers` 在应用级为**每个启用的 server** 各建一个 `Client`（长连接）；`mcpPiAdapter` 暴露单个网关工具代理调用。
2. **Pi 原生路径**（专家会话 / `mcpNativeBridge === true`）：`piMcpExtensionBridge` 用 Pi 的 `createMcpExtension`，transport 工厂在**会话启动时**自行 `StdioClientTransport` 拉起 stdio server（代码注释自述「the manager's connect path is not shared, only its resolution helpers」）。

切换条件：`piRuntimeSessionLaunch.ts`（`mcpNativeBridge === true || expertMcpIds.length > 0`，且非 chat 模式）。

## 疑点验证：同一 stdio server 被拉起两次

**结构性成立。** 应用级 `startServers` 在任一启用 server 的 MCP 初始化后保持运行（`isRunning` 复用），而专家会话的原生桥不会复用这些连接——同一 app 进程内，只要 (a) 任一 MCP server 已启用且 manager 已初始化（普通会话或 MCP 页触发），(b) 存在带 `mcpIds` 的专家会话，同一个 stdio server 就有两个进程/两份连接。运行时实证（进程列表对比）待实机验证，但代码路径无共享点。

## 后果

- 两套工具命名（网关工具 vs 原生工具名）、两套超时/错误语义、两份 prompt（`piMcpCapabilityPrompt` 只覆盖原生路径）。
- 双进程的内存与 stdio server 自身状态不共享（每个 server 的缓存/会话态分叉）。

## 统一方向（待对比数据后实施）

- 全部会话走 Pi 原生 MCP extension；用其 **deferred exposure / codemode** 解决当初做网关工具的理由——token 成本。**必须先 A/B**：同一任务集下「网关单工具 + manifest prompt」vs「原生 deferred/codemode」的 token、任务完成率对比（依赖 2026-10 算力部署，与 Pi 回放磁带重录同批）。
- 主进程保留：配置、凭据、OAuth、命令解析（`resolveStdioCommand` 已被两条路径共享）、按需短连接探测（健康检查）。
- `mcpServerManager` 的长连接池与工具清单职责退役；`piMcpCapabilityPrompt` 与网关 prompt 合一。
- 回放磁带覆盖新路径（依赖上游 key 重录，🔒）。

## 实施前置（阻塞项）

1. token 对比 A/B（需算力部署）。
2. Pi 回放磁带重录（需上游 API key）。
3. 设计轮次确认：工具命名取原生形态后，依赖网关工具名的既有用户会话/专家配置是否需要迁移视图（焦土原则下倾向不迁移，仅提示）。
