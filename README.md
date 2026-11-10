# 知远智能体国防版

知远智能体国防版面向内网部署。启动后直接进入工作台。历史会话、文件、产物预览和预装 Python 在离线时仍可使用。生成模型回复需要连接部署方的 AISphere。

本版采用独立应用标识与用户数据目录。模型目录来自 AISphere，发行包不提供免费模型、自定义模型服务、本地推理、模型市场、公网搜索、桌面伙伴、消息渠道和活动页面。预置「作战文书编写」「指挥所演习作战文书的编写和改写」两个专家及对应技能，并随包提供 Word、表格和 PDF 工具；这些能力只在专家与技能页面提供。

## 安装与升级

使用管理员分发的离线安装包。Windows x64 使用签名 `.exe`，麒麟 V11 x64 使用 `.rpm`。后续升级同样由管理员分发新版离线包。已安装版本可在「设置 → 关于」查看，也可以从该页导出本地诊断日志。

## 内网配置

1. 在「设置 → 平台模型」填写部署方提供的 AISphere 地址。OpenAI 兼容内网服务同时需要填写访问密钥，密钥由系统安全存储加密保存，页面和会话只使用本机网关凭据。连接后从平台目录选择默认模型。HTTPS 服务需使用部署环境信任的证书。
2. 工作区第一次使用 Python 时，会从安装包内的 wheel 仓初始化环境。常用文档、表格和数据处理依赖随包提供。
3. 如需安装额外的固定版本依赖，由管理员设置 `ZHIYUAN_DEFENSE_PYPI_INDEX_URL` 为单个内网 HTTPS PyPI 源并重启客户端。使用私有 CA 时，在启动环境设置 `SSL_CERT_FILE` 指向 PEM CA 文件。镜像未配置时只使用本地源。更多配置见 [Python 运行时说明](src/main/pythonRuntime/README.md#defense-edition)。

## 打包

长期维护分支为 `release/defense`。安装端无需访问构建时使用的依赖下载站点。

| 平台 | 命令 | 输出目录 |
| --- | --- | --- |
| Windows x64 | `make dist-win-defense` | `release/defense/` |
| 麒麟 V11 x64 | `make dist-kylin-defense` | `release/defense-kylin/` |

构建使用 Node 24、Bun 1.4 和 .NET 8 SDK。Windows 本地构建从 x64 Visual Studio Developer PowerShell 环境执行。签名与断网首启验收由 [Windows 工作流](.github/workflows/defense-windows.yml) 执行。麒麟在目标环境手动打包，需要 `rpm-build` 和原生编译工具链。

项目许可见 [AGPL-3.0](LICENSE)。
