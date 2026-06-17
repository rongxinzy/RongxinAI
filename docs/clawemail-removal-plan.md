# 龙虾邮箱（clawemail-email）完全移除计划

> 审计日期：2026-06-17 | 基于全仓库耦合分析

---

## 一、耦合审计结论

**可以安全移除。** `clawemail` 与 RongxinAI 的耦合点共 7 处，均为浅层引用，无深度业务逻辑绑定。

### 1.1 耦合全景

```
package.json                    ← 插件声明（1 处）
  └─ openclaw.plugins[clawemail-email]

src/shared/platform/constants.ts ← channelAliases（1 处）
  └─ ['clawemail', 'clawemail-email']

src/main/main.ts                ← SDK 动态导入（1 处）
  └─ require('@clawemail/node-sdk')

src/main/libs/openclawConfigSync.ts ← 插件同步逻辑（4 处）
  ├─ EMAIL_PLUGIN_ID = 'email'
  ├─ knownStalePluginIds 清除项
  ├─ pluginMatches('clawemail-email', EMAIL_PLUGIN_ID)
  └─ 注释

src/main/libs/openclawConfigSync.runtime.test.ts ← 测试（3 处）

src/renderer/services/i18n.ts   ← 中文标签（1 处）
  └─ '龙虾邮箱'

vendor/openclaw-plugins/clawemail-email/  ← 完整插件（~50 文件）
vendor/openclaw-runtime/*/third-party-extensions/clawemail-email/ ← 运行时副本
```

### 1.2 无耦合区域（已验证）

| 区域 | 状态 |
|------|------|
| `scripts/` | 零引用 |
| `electron-builder.json` | 零引用 |
| `.gitlab-ci.yml` | 零引用 |
| `SKILLs/` | 零引用 |
| `src/scheduledTask/` | 零引用 |
| Redux `imSlice.ts` | 使用通用 `config.email`，非 clawemail 特有 |
| IPC channels | 使用通用 `im:email:*`，非 clawemail 特有 |
| IM 设置 UI | 使用 `PlatformRegistry.platforms` 迭代，不硬编码 |

---

## 二、移除步骤

### 第一阶段：源码层（低风险，可单独 MR）

#### 步骤 1：移除插件声明

**文件：** `package.json` 第 35-38 行

```diff
- {
-   "id": "clawemail-email",
-   "npm": "@clawemail/email",
-   "version": "0.9.12"
- },
```

**影响：** `readPreinstalledPluginIds()` 不再返回 `clawemail-email`，网关不再加载此插件。

#### 步骤 2：移除 channelAliases 中的 clawemail

**文件：** `src/shared/platform/constants.ts` 第 103 行

```diff
- channelAliases: ['clawemail', 'clawemail-email'],
+ channelAliases: [],
```

**影响：** OpenClaw 网关不再将 `clawemail` / `clawemail-email` 识别为已知 channel。保留 `id: 'email'` 和 `channel: 'email'`，为将来自研邮箱预留。

#### 步骤 3：移除 SDK 动态导入

**文件：** `src/main/main.ts` 第 4561-4569 行

```diff
- } else if (instance.transport === 'ws') {
-   let fetchIMToken: (apiKey: string, email: string, logger: typeof console) => Promise<unknown>;
-   try {
-     ({ fetchIMToken } = require('@clawemail/node-sdk'));
-   } catch {
-     throw new Error('Email SDK not installed...');
-   }
-   await fetchIMToken(instance.apiKey!, instance.email, console);
- }
```

**影响：** 移除 `@clawemail/node-sdk` 的唯一运行时依赖。WebSocket 传输探测不再可用——若需保留 email 平台的 WS 探测能力，后续用自研 SDK 替换。

#### 步骤 4：清理 openclawConfigSync.ts

**文件：** `src/main/libs/openclawConfigSync.ts`

```diff
- const EMAIL_PLUGIN_ID = 'email';
```

```diff
- 'clawemail-email',  // knownStalePluginIds 中移除
```

```diff
- if (pluginMatches(plugin, 'clawemail-email', EMAIL_PLUGIN_ID))
+ // 龙虾邮箱已移除，email 平台暂无可用的 OpenClaw 插件
```

**影响：** `EMAIL_PLUGIN_ID` 常量仅在 `pluginMatches` 中使用，一并移除。`knownStalePluginIds` 中的条目成为死代码，未来也不会再产生此类 stale entry。

#### 步骤 5：更新测试

**文件：** `src/main/libs/openclawConfigSync.runtime.test.ts`

移除所有包含 `clawemail-email` 的测试夹具和断言（行 57, 746, 803）。

#### 步骤 6：更新 i18n

**文件：** `src/renderer/services/i18n.ts`

```diff
- email: '龙虾邮箱',    // 中文
- email: 'clawEmail',   // 英文
```

保留通用 email i18n 键（`emailConfig`, `emailInstance`, `imEmailAddInstance` 等），这些是将来自研邮箱的基础设施。

---

### 第二阶段：制品层（需同步 CI 缓存）

#### 步骤 7：删除插件目录

```bash
rm -rf vendor/openclaw-plugins/clawemail-email/
```

#### 步骤 8：删除运行时副本

```bash
rm -rf vendor/openclaw-runtime/win-x64/third-party-extensions/clawemail-email/
rm -rf vendor/openclaw-runtime/linux-x64/third-party-extensions/clawemail-email/
rm -rf vendor/openclaw-runtime/mac-arm64/third-party-extensions/clawemail-email/
```

#### 步骤 9：使 CI 缓存失效

修改 `.gitlab-ci.yml` 中 openclaw 缓存的 key：

```diff
- key: "win-openclaw-v2026.4.14"
+ key: "win-openclaw-v2026.4.14-v2"  # 清除含 clawemail 的旧缓存
```

所有平台（win/linux/mac）均需更新。

---

### 第三阶段：验证

#### 步骤 10：编译验证

```bash
npx tsc --noEmit                          # 渲染进程
npx tsc --project electron-tsconfig.json --noEmit  # 主进程
npm run build                             # 完整构建
```

#### 步骤 11：运行时验证

- [ ] 启动应用，IM 设置中不出现龙虾邮箱
- [ ] 定时任务通知渠道下拉不出现龙虾邮箱
- [ ] 网关启动日志无 `clawemail-email` 相关错误
- [ ] 现有飞书/微信/钉钉等其他 IM 功能正常

---

## 三、移除汇总

| 类别 | 文件数 | 行数 | 风险 |
|------|--------|------|------|
| 源码修改 | 5 | ~30 删 | 低 |
| 测试修改 | 1 | ~10 删 | 低 |
| 目录删除 | 2-4 | ~50 文件 | 中（需同步 CI 缓存） |
| CI 配置 | 1 | ~3 改 | 低 |

## 四、回滚方案

若移除后发现问题，恢复步骤：

1. `git revert` 移除提交
2. 恢复 `vendor/openclaw-plugins/clawemail-email/` 从 git history
3. 恢复运行时副本需**重新运行 `npm run openclaw:runtime:host`**（从内网镜像拉取）

> **注意：** 运行时副本不在 git 中（在 `.gitignore`），只能通过 openclaw runtime build 重新生成。

## 五、对将来自研邮箱的影响

| 保留项 | 用途 |
|--------|------|
| `Platform.id = 'email'` | 平台 ID 不变 |
| `Platform.channel = 'email'` | OpenClaw channel 名不变 |
| `im:email:*` IPC 通道 | 通用，可直接复用 |
| `state.config.email` Redux | 通用，可直接复用 |
| `IMSettings.tsx` 邮件 UI | 通用，可直接复用 |
| `emailConfig/emailInstance` i18n | 通用，可直接复用 |

只需开发新的 OpenClaw 插件替换 `@clawemail/email`，channel 名保持一致即可无缝接入现有 UI。

---

*Generated with Claude Code | 2026-06-17*
