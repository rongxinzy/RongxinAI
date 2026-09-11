# SoL-Pi 隔离接入（实验，默认关闭）

本目录把上游 [NVlabs/SoL-Pi](https://github.com/NVlabs/SoL-Pi)（MIT）以受控方式接入
知远的 Pi 执行内核。**默认完全关闭**，不影响任何现有会话行为。

## 事实来源与归属

- `vendor/sol-pi/`：上游源码原样拷贝，锁定 commit 见 `vendor/UPSTREAM_COMMIT`（审阅基于该提交）。
- `vendor/LICENSE.MIT`、`vendor/THIRD_PARTY_NOTICES.md`：上游归属。
- 不读取、不修改用户全局 Pi 安装（`~/.pi/agent/sol-pi.json` 的上游配置发现被
  app 内配置加载器替换，见 `solPiIntegration.ts`）。
- 运行时通过 jiti 加载 vendor（与 Pi 官方扩展加载同一策略），不经 tsc/oxlint 编译。

## 启用方式（实验入口）

```bash
# 基线（默认）
npm run electron:dev

# conservative profile：ActionFusion + ObservationPack
ZHIYUAN_SOLPI_PROFILE=conservative npm run electron:dev
```

`ZHIYUAN_SOLPI_PROFILE` 仅接受 `off`（默认）与 `conservative`；其余值告警并保持关闭。
reducer（额外模型调用）与 online context compaction 在本接入中**永不启用**。

## 边界与安全

1. **审批（ActionFusion）**：上游的 `then_run` 命令在工具内部直接执行 bash，不会
   产生 `bash` tool_call 事件。`solPiThenRunGuard` 在 fused `edit/write` 的
   `tool_call` 事件上拦截 `input.then_run`，先过 `getPiBashCommandViolation` 静态
   检查，再经 workbench `authorizeToolCall`（toolName=bash）走既有审批 UI。
   拒绝时**整条 fused 调用在写盘前被阻断**——与上游"先写后跑"不同，是有意的
   更严格偏离；被拒后不会重放写入。
2. **存储（ObservationPack）**：上游假设持久 Pi 会话目录；本仓库用
   `SessionManager.inMemory`（其 session dir 为空串）。`solPiSessionScope` 用原型
   委托包装 in-memory manager，把 `getSessionDir()` 指向 app 自有的
   `<userData>/solPi/sessions/<sessionId>/`；Pi 会话日志仍只在内存，不产生第二套
   canonical 任务状态。归档按内容寻址落在该目录，`onSessionDeleted` 时清理。
3. **会话启动**：Pi SDK 的 `createAgentSession` 不触发 `session_start`（只有 CLI
   模式调用 `bindExtensions`），而 SoL-Pi 在该事件上注册工具。启用时适配器显式
   调用 `session.bindExtensions({mode:'print', onError})`。
4. **不接入的范围**：子会话（subagent）的 resource loader 不挂 SoL 扩展；
   online context compact 依赖 `context.abort()` + 隐藏 `sendMessage` 续跑，与 app
   的 complete/error/stop 终态投影和 followUp 机制冲突，保持关闭。

## 离线对照 harness（机制验证，无真实模型）

```bash
node scripts/solpi-comparison-harness.mjs
```

真实 Pi 0.84.2 + 脚本化假模型（无网络、无凭据），有硬性调用数与进程时限。
覆盖三个场景并断言机制行为：fusion（同产物少一次模型往返）、denied then_run
（拒绝即不落盘、会话干净收敛）、40KB 观察（第 4 次请求投影从 ~48K 字节降到
~1.6K）。**它证明机制，不证明真实模型收益**。

## 真实模型对照（后续验收）

同一模型/输入下交错运行基线与 conservative，任务集建议：PPT 生成、代码修改
（编辑+验证命令）、长日志诊断各 2 条 × 3 次重复。指标：交付产物质量（人工+
验证器）、模型调用数、输入 token（usage.input）、耗时、审批正确性（无绕过）、
停止正确性（无假完成/假错误）。验收门槛：任何 then_run 绕过审批、写入重放或
假完成即失败；机制正确后再比较 token/耗时，禁止用离线数字宣称节约率。

## 已知限制 / 剩余工作

- 打包版 Electron 尚未把 vendor TS 复制进应用包（dev 模式可用）；打包需要
  electron-builder extraResources 步骤。
- env var 为进程级开关（所有新会话共享）；按会话粒度开关需要 config/UI 变更。
- 真实模型收益未测（见上）。
