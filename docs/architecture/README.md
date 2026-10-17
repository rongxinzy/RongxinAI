# 架构文档（Architecture）

面向贡献者与 agent 的**现行**架构说明。历史 PR/迁移笔记在 `docs/` 其它路径，若与本文冲突以本文与 `main` 代码为准。

| 文档 | 说明 |
| --- | --- |
| [overview.zh-CN.md](overview.zh-CN.md) | 进程边界、目录导览、Pi 引擎、本地推理、IPC、发版与代码门禁 |
| [streaming.md](streaming.md) | Cowork 流式链路：Pi 事件 → UIMessageChunk 增量 → 16ms 单点合并 → 序列化 IPC → rAF 批处理 → LiveTextStore，快照仅限异常路径与终态 |

Agent 编码规则仍以 [AGENTS.md](../../AGENTS.md) 为准；PR 流程见 [DEVOPS.md](../../DEVOPS.md)、[CONTRIBUTING.md](../../CONTRIBUTING.md)。发版细节见 [RELEASING.md](../../RELEASING.md)。
