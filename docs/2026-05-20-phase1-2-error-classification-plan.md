# Phase 1.2: 错误分类体系 — 实施计划

日期：2026-05-20

## 目标

将 RongxinAI 的错误处理从**正则匹配字符串 → i18n key**的单层模型，升级为**类型化错误枚举 → 分级日志策略 → 差异化用户提示 → 自动恢复行为**的多层模型。

对应 OpenHuman 的 `src/core/jsonrpc.rs:rpc_handler` 5 种错误类别 + Sentry `before_send` 过滤策略。

## 当前问题清单

### 问题 1：错误全链路 `string` 类型

```
OpenClaw Gateway 返回原始字符串
  → OpenClawRuntimeAdapter: emit('error', sessionId, errorString)
    → CoworkEngineRouter: emit('error', sessionId, error)
      → IPC: { sessionId, error: string }
        → CoworkService: classifyError(error) → regex → i18n key
```

### 问题 2：ENGINE_NOT_READY 魔法字符串

`main.ts` 中 3 处 `result.code === 'ENGINE_NOT_READY'` 用于控制 UI 分支。

### 问题 3：regex 规则顺序依赖

`classifyErrorKey()` 中 RESOURCE_EXHAUSTED 必须在 billing 之前匹配，顺序隐式依赖无编译期保护。

### 问题 4：无结构化元数据

`error: string` 丢失了 HTTP 状态码、retryAfter、provider、requestId 等信息。

### 问题 5：IM 回复无差异化话术

所有错误对 IM 用户返回相同话术。

### 问题 6：日志无错误分级

`console.error` / `console.warn` / `console.log` 混用，无统一策略。

## 实施步骤

### Step 1: 定义类型化错误模型

创建 `src/common/coworkError.ts`:

- `CoworkErrorKind` — discriminated union: auth_expired | rate_limited | budget_exceeded | input_too_long | model_not_found | content_filtered | gateway_disconnected | engine_not_ready | network_error | server_error | tool_timeout | tool_permission_denied | max_iterations | unknown
- `CoworkError` interface — { kind, message, statusCode?, retryAfterMs?, provider?, requestId? }
- `classifyCoworkError(rawError: string): CoworkError` — 替代 classifyErrorKey
- `getErrorLogLevel(kind): 'error' | 'warn' | 'info' | 'debug'`
- `isTransient(kind): boolean` — 是否可自动重试
- `getUserAction(kind): string` — 用户操作建议的 i18n key

### Step 2: 改造错误产生端（OpenClawRuntimeAdapter）

- 在 `openclawRuntimeAdapter.ts` 捕获 OpenClaw Gateway 错误时，调用 `classifyCoworkError()` 生成 CoworkError
- 更新 `CoworkRuntimeEvents.error` 签名：`(sessionId: string, error: CoworkError) => void`
- 提取 HTTP 状态码、Retry-After 头等元数据

### Step 3: 改造错误传播路径

- `CoworkEngineRouter`: 更新 error 事件类型
- IPC `cowork:stream:error`: 更新 payload 结构
- `preload.ts`: 更新 `onStreamError` 类型
- `CoworkService.onStreamError`: 按 kind 差异化处理
  - `auth_expired` → 触发 auth 重新认证
  - `rate_limited` → 显示倒计时
  - `engine_not_ready` → 显示引擎状态
  - 其余 → 显示错误消息

### Step 4: 统一 main.ts 错误响应

- 定义 `CoworkErrorCode` 常量：`ENGINE_NOT_READY = 'ENGINE_NOT_READY' as const`
- 替换所有 `result.code === 'ENGINE_NOT_READY'` 魔法字符串
- `getEngineNotReadyResponse()` 返回带 kind 的 CoworkError

### Step 5: IM 差异化错误话术

- `imCoworkHandler.ts`: 按 kind 生成不同 IM 回复
  - auth_expired → "AI 助手认证已过期，请打开应用更新 API Key"
  - rate_limited → "AI 助手暂时繁忙，稍后自动重试"
  - server_error → "服务端异常，已自动重试中"

### Step 6: 日志分级

- 在 `coworkLogger.ts` 中添加 `logCoworkError(error: CoworkError)` 函数
- 按 kind 自动选择日志级别
- Sentry 按 kind 决定是否上报（auth_expired 不上报，server_error 必须上报）

## 文件变更范围

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/common/coworkError.ts` | 新增 | CoworkError 类型定义 + 分类器 |
| `src/common/coworkErrorClassify.ts` | 修改 | 重构为基于 CoworkError 的新分类器 |
| `src/main/libs/agentEngine/types.ts` | 修改 | error 事件签名改为 CoworkError |
| `src/main/libs/agentEngine/coworkEngineRouter.ts` | 修改 | 传播 CoworkError |
| `src/main/libs/agentEngine/openclawRuntimeAdapter.ts` | 修改 | 错误产生端生成 CoworkError |
| `src/main/main.ts` | 修改 | 替换 ENGINE_NOT_READY 魔法字符串 |
| `src/renderer/services/cowork.ts` | 修改 | 按 kind 差异化处理 |
| `src/main/im/imCoworkHandler.ts` | 修改 | 差异化 IM 错误回复 |
| `src/main/libs/coworkLogger.ts` | 修改 | 错误分级日志 |

## 验收标准

- [ ] CoworkErrorKind 涵盖所有当前 regex 规则覆盖的错误类型
- [ ] 全链路 error 从 `string` 变为 `CoworkError` 对象
- [ ] `ENGINE_NOT_READY` 魔法字符串替换为类型常量
- [ ] `classifyCoworkError()` 替代 `classifyErrorKey()`，无 regex 顺序依赖
- [ ] 每种 kind 有明确的日志级别和用户提示策略
- [ ] TypeScript 编译通过（tsconfig.json + electron-tsconfig.json）
- [ ] 现有测试通过

## 不在此次范围

- Sentry 实际集成（当前项目无 Sentry SDK 依赖）
- 自动重试的 backoff 机制实现（仅定义 isTransient 标志和 retryAfterMs 字段）
- IM 消息的完整多语言话术（仅定义 i18n key 映射）
