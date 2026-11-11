# Pi 上下文压力修复

## 来源与接入

维护 fork：[hawkli-1994/pi](https://github.com/hawkli-1994/pi)，分支 `codex/context-pressure-recovery`，基线为上游 `v1.5.2`（`b4afdddf44e059c67ccf5097e5317d913521b470`）。本次修复固定为提交 [`9626bbd42749243fad63bef7fbe04154bac294b9`](https://github.com/hawkli-1994/pi/commit/9626bbd42749243fad63bef7fbe04154bac294b9)。

应用的 Pi 依赖从 1.4.0 升到 1.5.2；原生源码修复经现有 `patch-package` 安装机制进入 `pi-ai` 和 `pi-coding-agent`。这是一项安装时的依赖补丁，运行时仍由 Pi 自己负责压缩、重试和任务循环。补丁同时保留原有的空 content 容错和本地提供方 overflow 错误识别。

## 确定性故障链

1. Pi 用提供方 usage 判断超过压缩阈值，却用 `字符数 / 4` 决定保留哪些历史。中文上下文的实际计数达到约 63K 时，字符估算可能仍低于默认的 20K 保留预算，导致没有可摘要前缀。
2. 自动压缩原来把“无法准备摘要”静默返回为 `false`，与“压缩成功但不需要续跑”混在一起。后续请求仍携带原上下文。
3. 发送层扣除安全余量后没有输出空间，仍把 `max_tokens` 钳制到 1，制造连续 `length`。
4. 恢复路径先持久化删除截断响应的 context edit，随后才尝试摘要。这会提前失效最新 usage；即使摘要失败，历史和恢复次数也已经改变。
5. 压缩后保留的旧 assistant usage 仍可进入发送层的预算估算。相同毫秒内的压缩和消息使时间戳判断不可靠，可能压缩成功后仍再次得到 1-token 请求。

这些缺陷主要位于 Pi 的压缩准备、会话投影和提供方预算层。这些层负责会话历史与网络协议，必须存在；应修正它们共享的状态与计数规则，而不是在应用外围再建立一个执行循环。

## 修复后的职责

- 压缩切分用真实 usage 校准历史大小的估算。自动压缩确有必要时，保留预算不能阻止选择已有的安全切分点，工具调用与结果仍保持配对。
- 摘要规划在临时投影中运行。摘要成功后才提交 omission 和 compaction；失败或取消保留原历史、usage 和恢复机会。
- 原生自动压缩明确区分成功、失败与取消。请求前压缩失败不会静默发送相同的过满上下文。
- 会话投影按持久化顺序失效压缩/编辑前的 usage；原始消息仍保留计费和诊断信息。
- 输出预算耗尽时产生可识别的原生 overflow，不强行发出 1-token 请求。用户明确请求 1 token 且上下文足够时仍被尊重。
- 小窗口模型的默认保留量与预留量由 Pi 在读取设置时计算。显式设置和模型覆盖仍优先；模型切换、重载与子任务不再依赖应用重复写入预算。

应用也有责任：本次移除启动、继续、队列和子任务路径重复覆盖压缩参数的代码及失效字段；保留已有的截断终态检查，禁止未恢复的 `length` 被标成完成。升级同时将伴随助手的 TypeBox 导入改到实际提供该 API 的 `typebox` 包。

## 验证方式

新增 `piContextPressure.test.ts` 进入日常单测。它走真实 Pi SDK、HTTP/SSE 解析、工具写入、SQLite 和文件持久化会话；提供方计数独立于字符估算，包含 cache hits，并固定时钟以覆盖同毫秒边界。成功用例验收全部 32 个文档文件和索引、报告；连续截断用例验收完成事件为零、恢复一次后错误可见。

Fork 的 `context-pressure.test.ts` 另外验证内存/持久化会话、连续多次阈值压缩、length 恢复、摘要失败后继续、取消后继续；设置和输出预算测试验证小模型切换及合法的 1-token 请求。现有原生工具配对、排队续跑和扩展压缩回归一并运行。

这些是可重复的协议与状态回归，不依赖录制磁带，也不证明真实模型会正确理解全部文档。本次没有把新的 32/48 文档真实模型验收标为通过。复测应同时记录压缩事件、压缩后 usage、发送的输出预算、终态和实际产物，不能只断言 `complete`。

2026-11-11 本地结果：应用相关单测 560 项、原生 SDK 集成 2 项通过；Electron 类型检查、应用构建、格式检查、Knip 与 lint 命令通过。lint 仍报告未改动 llama.cpp 组件中的存量警告，Knip 有 3 项存量配置提示。没有验证真实 Electron 窗口和安装包。

Fork 相关回归 172 项通过、43 项离线/API 测试跳过；全仓 Biome、浏览器打包冒烟、依赖与入口静态检查通过；修改文件及其导入图的 TypeScript 检查通过。完整 monorepo TypeScript 检查受未安装的上游开发依赖和示例工作区依赖阻塞，未标为通过。

依赖审阅包含 Pi 带入的 Undici 8.10.2 → 8.12.3：已查阅中间版本发布说明，涉及 HTTP/2 超时、代理、取消和 TLS 修复；本次真实 HTTP/SSE 回归覆盖基础传输与取消，未覆盖全部 HTTP/2、TLS 和代理部署。[Undici 8.12.3 发布说明](https://github.com/nodejs/undici/releases/tag/v8.12.3)。

安装验证：`bun install --frozen-lockfile --ignore-scripts` 后运行 `bun run apply:patches`。相关测试：

```sh
bun run test:unit -- src/main/libs/agentEngine src/main/companion
bunx vitest run src/main/libs/agentEngine/piNativeLongTask.integration.test.ts
bun run typecheck:electron
bun run build
```

## 边界

这次修复不承诺无限恢复。没有安全可压缩历史、提供方拒绝摘要、用户取消、或一次原生恢复后仍连续截断时，必须保留诊断并明确结束为失败/取消，不能伪装完成。超大的不可压缩系统提示、工具定义或单条工具结果仍需要单独处理其来源。
