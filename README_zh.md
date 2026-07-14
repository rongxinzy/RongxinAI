# 李知远智能体

<p align="center">
  <img src="public/logo.png" alt="李知远智能体" width="120">
</p>

<p align="center">
  <strong>基于 OpenClaw 与 llama.cpp 的一体化本地 AI Agent 工作台</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
  <br>
  <img src="https://img.shields.io/badge/Platform-macOS%20%7C%20Windows%20%7C%20Linux-brightgreen?style=for-the-badge" alt="Platform">
  <br>
  <img src="https://img.shields.io/badge/Electron-40-47848F?style=for-the-badge&logo=electron&logoColor=white" alt="Electron">
  <img src="https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React">
</p>

<p align="center">
  <a href="README.md">English</a> | 中文
</p>

---

李知远智能体是一款由北京容芯致远推出的本地优先桌面 AI Agent 工作台，英文产品名为 LEO，面向开发、研究、自动化和个人效率场景。它把 OpenClaw runtime、llama.cpp 本地推理、内置技能、MCP 扩展、定时任务以及 IM/邮件触达能力整合在一个应用里。

李知远智能体不是单纯的聊天界面，而是一个可以在本机执行任务、请求高风险工具审批、管理本地 GGUF 模型、运行周期任务，并通过桌面端和移动端持续触达的 Agent 执行环境。

## 核心能力

- **Cowork Agent 工作流**：支持多步骤任务执行，覆盖文件操作、终端命令、浏览器自动化、文档处理和审批门控操作。
- **llama.cpp 本地推理**：管理本地 GGUF 模型、配置 `llama-server`、把本地模型接入 Agent 工作流。
- **模型市场**：基于 ModelScope 搜索 GGUF 模型，并直接安装到应用管理的 llama.cpp 目录。
- **技能与 MCP**：使用内置技能，并通过 MCP 接入外部工具或企业内部服务。
- **定时任务**：创建日报、跟进、收件箱清理、周期报告等后台任务。
- **IM 与邮件触达**：支持微信、企业微信、钉钉、飞书/Lark、QQ 和邮箱。
- **本地数据与权限控制**：会话、配置和任务元数据保存在本地 SQLite 中，高风险工具调用需要审批。

## 工作原理

<p align="center">
  <img src="public/readme/rongxinai_architecture_zh.svg" alt="李知远智能体架构" width="760">
</p>

李知远智能体使用 Electron 严格进程隔离架构。Renderer 承载 React UI，Preload 通过 `contextBridge` 暴露受控 IPC，Main Process 负责 OpenClaw 会话、llama.cpp 生命周期、本地存储、技能系统、MCP 接入和消息网关。

## 快速开始

### 环境要求

- Node.js `>=24 <25`
- npm

### 本地开发

```bash
git clone https://github.com/rongxinzy/RongxinAI.git RongxinAI
cd RongxinAI
npm install
npm run electron:dev
```
### 开发环境下使用llama服务
```bash
# 安装llamacpp服务
npm run llamacpp:runtime:download
# 安装openclaw服务
npm run electron:dev:openclaw

npm run electron:dev
```
当前仓库名称仍然保留为 `RongxinAI`，以兼容现有代码与流程。

默认 Vite 开发服务器地址为 `http://localhost:5175`。

### 使用 OpenClaw 与 llama.cpp 开发

```bash
npm run electron:dev:openclaw
```


该命令会确保固定版本的 OpenClaw runtime、准备当前主机所需的 llama.cpp runtime，并启动 Electron 开发应用。

常用 OpenClaw 构建变量：

| 变量 | 说明 |
| --- | --- |
| `OPENCLAW_SRC` | 本地 OpenClaw 源码目录 |
| `OPENCLAW_FORCE_BUILD=1` | 强制重新构建 OpenClaw runtime |
| `OPENCLAW_SKIP_ENSURE=1` | 跳过自动切换 OpenClaw 版本 |

## 构建与打包

```bash
npm run build
npm run lint
npm test
npm run compile:electron
```

平台打包：

```bash
npm run dist:mac
npm run dist:win
npm run dist:linux
```

桌面安装包会包含所需的 OpenClaw runtime。本地推理链路使用 llama.cpp，并通过项目脚本独立管理对应 runtime。

## 主要模块

### Cowork

Cowork 是核心会话系统。用户任务从 Renderer 通过 IPC 发送到 Main Process，再交给 OpenClaw 执行。消息、权限请求、工具状态和完成事件会实时流回 UI。

关键流式事件：

| 事件 | 说明 |
| --- | --- |
| `message` | 会话新增消息 |
| `messageUpdate` | 流式内容增量更新 |
| `permissionRequest` | 工具调用需要审批 |
| `complete` | 会话执行完成 |
| `error` | 会话执行失败 |

### llama.cpp 本地推理

本地推理工作台用于管理应用托管的 `llama-server` 进程、本地 GGUF 模型、基于 ModelScope 的模型市场，以及每个模型的启动参数，例如上下文长度、GPU offload 层数、线程数、批大小、主 GPU、内存映射和 keep-alive。

当前默认本地模型目录如下，目录名仍保留旧值以兼容现有安装：

- macOS: `~/Library/Application Support/RongxinAI/models/llamacpp`
- Windows: `%APPDATA%\\RongxinAI\\models\\llamacpp`

如果在服务配置里设置了 `modelsDir`，则以自定义目录为准。

### 技能与 MCP

`SKILLs/` 目录包含内置技能，`SKILLs/skills.config.json` 控制默认启停与排序。MCP 设置用于接入 GitHub、浏览器、数据库、文件系统以及企业内部服务等外部工具。

常见内置技能：

| 技能 | 用途 |
| --- | --- |
| `web-search` | 搜索与资料收集 |
| `docx` / `xlsx` / `pptx` / `pdf` | Office 与文档处理 |
| `playwright` | 浏览器自动化 |
| `remotion` | 视频生成 |
| `imap-smtp-email` | 邮件收发 |
| `stock-*` | 投研与公告检索 |
| `skill-creator` | 自定义技能创建 |

### 定时任务

定时任务既可以通过自然语言创建，也可以在 GUI 中配置。任务触发后，李知远智能体会启动 Cowork 会话执行，并将结果保留在桌面端；如配置了通知渠道，还可以投递到 IM 或邮件。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 桌面框架 | Electron 40 |
| 前端 | React 18 + TypeScript |
| 构建 | Vite 5 |
| 样式 | Tailwind CSS |
| 状态管理 | Redux Toolkit |
| Agent runtime | OpenClaw |
| 本地模型 | llama.cpp |
| 存储 | better-sqlite3 |
| 渲染 | react-markdown / Mermaid / KaTeX |

## License

[MIT License](LICENSE)
