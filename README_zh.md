<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/zhiyuan-logo-dark-1600.png">
    <img src="public/zhiyuan-logo-light-1600.png" alt="知远智能体" width="160">
  </picture>
</p>

<h1 align="center">知远智能体</h1>

<p align="center"><strong>把任务交给 AI，在自己的电脑上完成工作。</strong></p>
<p align="center">开源 · 本地优先 · 文件与浏览器操作 · 本地模型 · 可复用工作流</p>

<p align="center">
  <a href="https://www.rongxzyai.com/#download">下载安装</a> ·
  <a href="#开始使用">开始使用</a> ·
  <a href="#开发者快速开始">本地开发</a> ·
  <a href="https://github.com/rongxinzy/RongxinAI/issues">反馈问题</a> ·
  <a href="README.md">English</a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="AGPL-3.0"></a>
  <a href="https://github.com/rongxinzy/RongxinAI/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/rongxinzy/RongxinAI/ci.yml?branch=main&amp;label=CI" alt="CI"></a>
  <a href="https://github.com/rongxinzy/RongxinAI/stargazers"><img src="https://img.shields.io/github/stars/rongxinzy/RongxinAI?style=flat" alt="GitHub Stars"></a>
</p>

知远智能体是北京容芯致远推出的桌面 AI 工作台，由李可然维护。你可以让它整理资料、制作文档、分析表格、研究代码或执行周期任务。它能读写文件、运行命令、操作浏览器，并在工作过程中展示消息、工具调用与结果。

<p align="center">
  <img src="public/readme/zhiyuan-ppt-demo.gif" alt="知远根据自然语言任务制作演示文稿的操作录屏" width="960">
</p>
<p align="center"><sub>从任务描述到演示文稿，查看执行过程并取得生成文件。</sub></p>

## 用知远完成什么

| 场景 | 工作方式 |
| --- | --- |
| 资料研究 | 检索网页、阅读本地资料，整理带来源的研究结果 |
| 文档与表格 | 制作演示文稿，处理 Word、PDF、Excel，分析数据并生成文件 |
| 代码工作 | 选择项目目录，阅读仓库、修改代码、运行命令并检查产物 |
| 日常任务 | 用待办记录工作，通过定时任务安排简报、报告和其他重复流程 |
| 浏览器操作 | 让智能体在浏览器中查找信息、操作页面，并展示执行进度 |
| 消息协作 | 配置微信、企业微信、钉钉、飞书/Lark、QQ 或邮箱，在已接入的渠道中使用智能体 |

专家提供面向具体工作的预设；技能封装可复用的方法和工具；MCP 用于连接外部服务。你可以使用内置内容，也可以扩展自己的工作流。

## 开始使用

1. 从[官网](https://www.rongxzyai.com/#download)选择适合自己系统的安装包。发布记录和可下载附件见 [GitHub Releases](https://github.com/rongxinzy/RongxinAI/releases)。
2. 打开应用，使用内置的**知远免费模型**开始对话，无需先填写第三方 API Key。也可以在模型设置中配置自己的服务。
3. 处理本地文件或代码时，选择对应项目目录，描述任务，并按需附上资料。
4. 查看执行过程、处理授权请求，检查生成结果后继续追问或修改。

免费模型需要联网，服务可用性及额度以应用内提示为准。桌面工程支持 macOS、Windows 和 Linux；具体安装包与架构以下载页为准，也可以[从源码运行](#开发者快速开始)。

### 使用本地模型

在「本地推理」中浏览模型市场，选择适合设备的 GGUF 模型及量化版本，安装后启动服务。工作台提供上下文长度、GPU 分配、线程等设置，可将运行中的本地模型用于智能体任务。

本地运行模型可以减少对云端推理的依赖。联网搜索、模型下载、远程 MCP 和消息渠道仍需要对应网络服务。

### 数据与权限

会话、配置和任务元数据保存在本机；本地文件由桌面执行环境访问。使用云端模型或远程工具时，请求所需内容会发送给相应服务。

工具执行遵循当前权限模式。需要审批的操作会显示授权请求；开启自动授权后，部分操作可直接执行。任务执行过程和结果可以在工作台中查看。

## 选择一套喜欢的界面

知远提供 **Codex**、**大明风华** 与 **长安风物** 三套主题。Codex 使用中性色与紧凑控件；大明风华以纸白、朱红与墨色为主；长安风物采用绢白、孔雀青、暖金和圆润控件，并提供墨青色的夜间外观。

在「设置 → 外观」直接选择主题预览卡片，再选择浅色、深色或跟随系统。所有卡片随模式同步更新。背景、纹理、字体、圆角、控件与交互状态由整套主题统一定义。

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/theme-previews/appearance-settings-dark.png">
    <img src="docs/theme-previews/appearance-settings-light.png" alt="外观设置组件：上方选择主题预览卡片，下方统一切换明暗模式" width="760">
  </picture>
</p>

主题作者可从[主题开发文档](src/renderer/theme/README.md)和[设计规范](DESIGN.md)开始。主题包提供展示数据，业务组件继续负责交互与状态。

## 开发者快速开始

需要 Git、Node.js **24.x** 和 [`package.json`](package.json) 指定的 Bun **1.4.0**。原生依赖无法使用预编译包时，需要 Python 与 C/C++ 构建工具；Windows 构建环境见[贡献指南](CONTRIBUTING.md)。

```bash
git clone https://github.com/rongxinzy/RongxinAI.git ZhiYuanAgent
cd ZhiYuanAgent
bun install
bun run electron:dev
```

开发启动脚本会准备消息渠道和记忆运行时，启动 Vite 与 Electron。首次准备运行时需要联网。若需要本地推理，可单独下载当前主机的推理运行时：

```bash
bun run llamacpp:runtime:download
```

### 常用命令

| 命令 | 用途 |
| --- | --- |
| `bun run build` | 类型检查、生产构建与运行时依赖检查 |
| `bun run test` | 运行项目测试脚本，处理原生模块环境并恢复 Electron 依赖 |
| `bun run lint` | 代码检查、主题生成一致性与样式归属审计 |
| `bun run format:check` | 检查代码格式 |
| `bun run test:bundle-budget` | 检查已构建的渲染端包体积 |
| `bun run theme:generate` | 修改主题定义后重新生成 CSS |
| `bun run compile:electron` | 编译 Electron 主进程，含原生依赖准备 |

发行打包命令为 `bun run dist:mac`、`bun run dist:win`、`bun run dist:linux`。它们还涉及平台运行时、资源与签名配置，详见[贡献指南](CONTRIBUTING.md)及 [`package.json`](package.json)。

### 项目结构

| 路径 | 职责 |
| --- | --- |
| [`src/renderer`](src/renderer) | 工作台、会话、设置、本地推理等 React 界面 |
| [`src/shared`](src/shared) | 共享 UI、类型与通信契约 |
| [`src/main`](src/main) | 桌面生命周期、任务执行、存储与系统服务 |
| [`src/main/preload.ts`](src/main/preload.ts) | 通过 `contextBridge` 暴露受控 IPC |
| [`src/renderer/theme`](src/renderer/theme) | 主题契约、组件外观、背景与生成器 |
| [`SKILLs`](SKILLs) / [`MCPs`](MCPs) | 内置技能与工具集成 |
| [`.github/workflows`](.github/workflows) | 测试、安装验收和发布流程 |

技术栈包括 Electron、React、TypeScript、Vite、Tailwind CSS、Redux Toolkit 和 SQLite，具体版本以 [`package.json`](package.json) 与 [`bun.lock`](bun.lock) 为准。

<details>
<summary>查看桌面架构</summary>

<p align="center">
  <img src="public/readme/zhiyuan_agent_architecture_zh.svg" alt="知远桌面架构与模块关系" width="760">
</p>

渲染进程负责界面，Preload 提供通信边界，主进程负责会话、执行、数据与服务生命周期。任务消息、工具状态和授权请求通过事件回到界面；本地推理、技能、MCP 和消息渠道由对应服务管理。

</details>

## 参与项目

- [报告问题](https://github.com/rongxinzy/RongxinAI/issues/new?template=bug_report.yml)：附上系统、版本、复现步骤和相关日志。
- [提出功能建议](https://github.com/rongxinzy/RongxinAI/issues/new?template=feature_request.yml)：描述实际场景与预期行为。
- [贡献代码或文档](CONTRIBUTING.md)：先阅读 [`AGENTS.md`](AGENTS.md)；涉及界面时同时遵守 [`DESIGN.md`](DESIGN.md)。

欢迎通过 Star 关注项目，也欢迎分享你用知远完成的工作流。

## 致谢与许可证

感谢 [AnySearch](https://github.com/anysearch-ai) 对内置联网搜索能力的支持，相关实现见 [`SKILLs/web-search`](SKILLs/web-search)。

本项目采用 [GNU Affero General Public License v3.0](LICENSE)。
