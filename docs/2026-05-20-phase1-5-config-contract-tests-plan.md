# Phase 1.5: OpenClaw Config Contract Tests — 实施计划

日期：2026-05-20

## 目标

为 RongxinAI 生成的 `openclaw.json` 建立结构性验证测试，在 OpenClaw 升级或 config sync 逻辑修改时立即发现兼容性问题。

## 范围

### 在范围内

1. **`buildProviderSelection` 输出结构验证** — 验证每个 provider descriptor 包含 OpenClaw 要求的必填字段
2. **最小 config 结构验证** — 验证 `writeMinimalConfig` 输出的 JSON 包含必需顶层 key
3. **完整 config 关键路径验证** — 用最小 mock 调 `sync()`，验证生成文件中的 `gateway`、`agents`、`providers` 段

### 不在范围内

- Runtime smoke test（需 gateway 二进制，后续 Phase）
- IM payload contract test（需具体 plugin 版本）
- 全量 schema 一致性验证（OpenClaw 自身职责）

## 实施步骤

### Step 1: buildProviderSelection 输出结构测试

扩展 `openclawConfigSync.test.ts`，为每种 provider 验证：
- 输出包含 `providerId`、`primaryModel`、`providerConfig`
- `providerConfig` 包含 `baseURL`、`apiKey`、`api`、`models`

### Step 2: 最小 config 结构测试

验证 `sync()` 在无 API 配置时生成的 minimal config 包含：
- `gateway.mode` = 'local'
- `agents.defaults` 段
- `meta` 段

### Step 3: 完整 config 关键段测试

用模拟 API config 调用 `sync()`，验证：
- `providers` 段包含正确的 provider 结构
- `gateway` 段包含 `auth`、`mode`
- 不包含意外的空值或 undefined

## 文件变更

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/main/libs/openclawConfigSync.test.ts` | 扩展 | 新增 contract test cases |
| `src/main/libs/openclawConfigSync.contract.test.ts` | 新增 | 集成测试：完整 config 生成 |

## 验收

- [ ] 每种 provider descriptor 结构通过验证
- [ ] 最小 config 结构通过验证
- [ ] TypeScript 编译通过
- [ ] 新增测试通过
