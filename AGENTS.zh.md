# AGENTS.zh.md

本仓库的唯一开发规范为根目录下的 `AGENTS.md`。开始开发前必须完整阅读并遵守该文件；本文件不再维护独立副本，以免架构、构建命令和测试要求发生漂移。

当前运行时边界：Pi 是 Work、Chat、Channel 和 Cron 的唯一 Agent 执行器；cc-connect 仅负责频道与定时触发传输；知远 SQLite 是 Task、Run、Delivery、ChannelAccount 和 ChannelSession 的唯一事实源。旧运行时的数据、配置和目录就地废弃，不读取、不迁移、不启动、不打包，也不提供回退路径。
