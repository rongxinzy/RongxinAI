# Phase 1.3: 日志关联 ID 与脱敏覆盖率 — 实施计划

日期：2026-05-20

## 目标

将 RongxinAI 的日志系统从**无关联 ID、脱敏覆盖率 ~2%** 升级为**关联 ID 贯穿请求链路、脱敏覆盖率 100%、统一模块前缀规范**。

## 当前问题

### 问题 1：无关联系 ID

IM 消息 → Cowork 会话 → LLM 请求 → 回复，整条链路无关联 ID。排查问题时无法从一条日志追溯到相关的上下游日志。

### 问题 2：脱敏覆盖率极低

`serializeForLog()` 存在于 `sanitizeForLog.ts`，但 1020 处 `console.log` 调用中仅 24 处使用（覆盖率约 2.4%）。大量原始对象（headers、body、config）直接输出到日志。

### 问题 3：无统一模块前缀

模块前缀不统一：
- `[api:fetch]` / `[CoworkService]` / `[ChannelSync]` / `[OpenClawRuntime]` / `[IMGateway]`
- 部分日志无前缀

### 问题 4：coworkLogger 独立文件

`coworkLogger.ts` 写入独立的 `cowork.log`，不使用 `electron-log`。无脱敏、无关联系 ID。

### 问题 5：日志无结构化字段

所有日志都是纯文本，无结构化字段（sessionId、agentId、provider 等），无法按维度过滤分析。

## 实施步骤

### Step 1: 创建关联 ID 基础设施

新建 `src/main/libs/logCorrelation.ts`:

- `generateCorrelationId(): string` — 生成短 UUID（8 位 hex）
- `CorrelationContext` — AsyncLocalStorage 存储当前请求的关联 ID
- `getCurrentCorrelationId(): string | undefined`
- `runWithCorrelationId(id, fn)` — 在关联 ID 上下文中执行函数

### Step 2: 创建结构化日志包装器

新建 `src/main/libs/structuredLog.ts`:

- `createLogger(module: string)` → 返回 `{ info, warn, error, debug }` 函数
- 自动添加 `[module]` 前缀 + 关联 ID + 时间戳
- 所有参数自动经过 `serializeForLog()` 脱敏
- `withContext(extra: Record<string, unknown>)` 添加结构化字段

### Step 3: 集成关联 ID 到关键路径

在以下位置注入关联 ID：
- `cowork:session:start` IPC handler → 为新会话生成关联 ID
- `imChatHandler` → IM 消息到达时生成关联 ID
- `openclawRuntimeAdapter` → 复用当前上下文的关联 ID
- 所有 IPC 流事件携带关联 ID（可选，后续）

### Step 4: 强制脱敏 - 替换关键 console.log 调用

替换以下高风险路径的 `console.log` 为 `structuredLog`:
- API 代理（`api:fetch`、`api:stream`）— headers 可能含 API Key
- OpenClaw gateway 消息日志
- IM 消息内容日志
- Auth 回调日志
- Cowork 配置日志

### Step 5: 废弃 coworkLogger 独立文件

- 将 `coworkLog()` 重定向到 `electron-log`（通过 structuredLog）
- 保留 `cowork.log` 作为可选的专用日志文件（后续可移除）

## 文件变更范围

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/main/libs/logCorrelation.ts` | 新增 | 关联 ID 生成 + AsyncLocalStorage 上下文 |
| `src/main/libs/structuredLog.ts` | 新增 | 结构化日志包装器（前缀+脱敏+关联ID） |
| `src/main/libs/sanitizeForLog.ts` | 修改 | 强化敏感 key 匹配模式 |
| `src/main/libs/coworkLogger.ts` | 修改 | 集成关联 ID + 脱敏 |
| `src/main/main.ts` | 修改 | 关键路径注入关联 ID，替换高风险 console.log |
| `src/main/libs/agentEngine/openclawRuntimeAdapter.ts` | 修改 | 关键日志使用 structuredLog |
| `src/main/im/imChatHandler.ts` | 修改 | IM 消息到达时生成关联 ID |
| `src/main/im/imCoworkHandler.ts` | 修改 | IM 错误日志使用 structuredLog |

## 验收标准

- [ ] 关联 ID 从 session 创建到结束贯穿全链路
- [ ] 核心路径（cowork/im/api）日志全部脱敏
- [ ] 模块前缀统一规范（`[ModuleName]`）
- [ ] 日志包含结构化字段（sessionId、errorKind 等）
- [ ] TypeScript 编译通过
- [ ] 现有测试通过
