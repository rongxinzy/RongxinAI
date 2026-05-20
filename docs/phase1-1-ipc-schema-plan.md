# Phase 1.1: IPC Schema / 白名单 / 权限边界 — 实施计划

## 目标

将 RongxinAI 的 Electron IPC 层从**宽松的字符串通道**升级为**类型安全的、Schema 验证的、白名单化的安全边界**。

对应 OpenHuman 的 Controller Registry 模式 (`src/core/all.rs` + `src/core/dispatch.rs`)。

## 当前问题清单

### 问题 1：IPC channel 命名三种风格混用

已常量化（好）：
```
ScheduledTaskIpc, OllamaIpcChannel, AgentIpcChannel, AppUpdateIpc,
MarketplaceIpcChannel, OpenClawSessionIpc, OpenClawSessionPolicyIpc
```

裸字符串（需要修复）：
```
cowork:session:start, cowork:session:continue, ... (20+ channels)
skills:list, skills:setEnabled, ... (11 channels)
auth:login, auth:exchange, ... (10 channels)
mcp:list, mcp:create, ... (7 channels)
im:config:get, im:gateway:start, ... (30+ channels)
dialog:selectDirectory, shell:openPath, ... (8 channels)
store:get, store:set, store:remove (3 channels)
hardware:nvidia-smi, permissions:*, enterprise:*, api:*, log:*, window:*, app:*
feishu:*, dingtalk:*, github-copilot:*, openai-codex-oauth:*
```

### 问题 2：通用 ipcRenderer 暴露绕过了安全边界

`preload.ts:174-183` 暴露了 `ipcRenderer.send` 和 `ipcRenderer.on` 的任意 channel 能力。

### 问题 3：main 端 handler 无参数校验

所有 `ipcMain.handle` 参数都是 `any` 类型或内联 interface，无运行时校验。

### 问题 4：api:fetch / api:stream 是通用 HTTP 代理

渲染进程可发起任意 URL 的 HTTP 请求。

### 问题 5：推送事件 payload 无类型约束

`onStreamMessage` 等回调的 data 参数大量使用 `any`。

## 实施步骤

### Step 1: 建立共享 IPC Schema 基础设施

创建 `src/shared/ipc/` 目录，包含：

- `src/shared/ipc/channels.ts` — 所有 IPC channel 名称的 `as const` 常量
- `src/shared/ipc/schemas.ts` — 各 channel 的 Zod 输入/输出 schema
- `src/shared/ipc/types.ts` — 从 Zod schema 派生的 TypeScript 类型
- `src/shared/ipc/index.ts` — barrel export

### Step 2: 逐域迁移 — 常量化 + Schema 化

每个域的改造模式：
1. 在 `channels.ts` 添加该域的 channel 常量
2. 在 `schemas.ts` 添加输入/输出 Zod schema
3. 修改 `preload.ts` 使用常量 + 类型化参数
4. 修改 `main.ts` handler 入口添加 `schema.input.parse()` 校验

迁移顺序（按风险从高到低）：
- 2a. `api:*` — 最高风险（通用 HTTP 代理），优先收敛
- 2b. `cowork:*` — 核心业务，channel 最多
- 2c. `im:*` — channel 量大，多实例 CRUD
- 2d. `auth:*` — 敏感操作
- 2e. `skills:*` / `mcp:*`
- 2f. `dialog:*` / `shell:*` / `window:*` / `store:*`
- 2g. `feishu:*` / `dingtalk:*` / `github-copilot:*` / `openai-codex-oauth:*`
- 2h. 其余（`hardware:*` / `permissions:*` / `enterprise:*` / `log:*` / `app:*`）

### Step 3: 移除通用 ipcRenderer 暴露

- 移除 `preload.ts` 中的 `ipcRenderer.send/on`
- 如有需要通用通道的场景，用显式命名的 API 替代

### Step 4: 添加启动时注册表交叉校验（可选，后续）

- 收集所有 `ipcMain.handle` 注册的 channel → Set A
- 收集所有 preload 暴露的 invoke channel → Set B
- 启动时检查 A 和 B 的对称性，警告未匹配项

## 文件变更范围

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/shared/ipc/channels.ts` | 新增 | 所有 IPC channel 常量 |
| `src/shared/ipc/schemas.ts` | 新增 | Zod 输入/输出 schema |
| `src/shared/ipc/types.ts` | 新增 | 派生类型 |
| `src/shared/ipc/index.ts` | 新增 | barrel export |
| `src/main/preload.ts` | 修改 | 使用常量 + 类型，移除裸 ipcRenderer |
| `src/main/main.ts` | 修改 | handler 入口添加 Zod 校验 |
| `src/main/im/*.ts` | 可能修改 | IM handler 如有独立注册 |
| `src/renderer/services/*.ts` | 可能修改 | 类型收窄 |
| `package.json` | 修改 | 添加 zod 依赖（如未安装） |

## 不在此次范围

- 已有的 `ScheduledTaskIpc` / `OllamaIpcChannel` / `AgentIpcChannel` 等常量保持不变（已经是正确模式）
- Redux state 的 Zod 校验（属于 renderer 内部关注，非 IPC 边界）
- OpenClaw Gateway 通信的 schema 校验（属于 OpenClaw 侧）
- 启动时注册表交叉校验（Step 4，后续迭代）

## 验收标准

- [ ] 所有 IPC channel 名称均为 `as const` 常量，无裸字符串
- [ ] 所有 `ipcMain.handle` 入口有 `schema.parse()` 校验
- [ ] `preload.ts` 不再暴露 `ipcRenderer.send/on` 的任意 channel 能力
- [ ] `api:fetch` / `api:stream` 收敛为有限的白名单 API
- [ ] TypeScript 编译通过，现有测试通过
- [ ] 主要用户流程手动验证通过（启动 → 创建会话 → 发送消息 → 权限审批 → IM 消息）
