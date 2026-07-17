# 知远智能体

<p align="center">
  <img src="public/logo.png" alt="知远智能体" width="120">
</p>

<p align="center">
  <strong>全栈自研的一体化本地 AI Agent 工作台</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
  <br>
  <img src="https://img.shields.io/badge/Platform-macOS%20%7C%20Windows%20%7C%20Linux-brightgreen?style=for-the-badge" alt="Platform">
  <br>
  <img src="https://img.shields.io/badge/Electron-40-47848F?style=for-the-badge&logo=electron&logoColor=white" alt="Electron">
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React">
  <img src="https://img.shields.io/badge/TypeScript-7-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Vite-8%20(Rolldown)-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite">
  <img src="https://img.shields.io/badge/Bun-1.3-000000?style=for-the-badge&logo=bun&logoColor=white" alt="Bun">
</p>

<p align="center">
  <a href="README.md">English</a> | 中文
</p>

---

知远智能体是一款由北京容芯致远推出的本地优先桌面 AI Agent 工作台，面向开发、研究、自动化和个人效率场景。Agent 运行时与本地推理引擎均为自研，并在一个应用里整合了内置技能、MCP 扩展、定时任务以及 IM/邮件触达能力。

知远智能体不是单纯的聊天界面，而是一个可以在本机执行任务、请求高风险工具审批、管理本地 GGUF 模型、运行周期任务，并通过桌面端和移动端持续触达的 Agent 执行环境。

## 核心能力

- **Cowork Agent 工作流**：支持多步骤任务执行，覆盖文件操作、终端命令、浏览器自动化、文档处理和审批门控操作。
- **本地推理**：管理本地 GGUF 模型、调优推理服务参数、把本地模型接入 Agent 工作流。
- **模型市场**：基于 ModelScope 搜索 GGUF 模型，并直接安装到应用管理的模型目录。
- **技能与 MCP**：使用内置技能，并通过 MCP 接入外部工具或企业内部服务。
- **定时任务**：创建日报、跟进、收件箱清理、周期报告等后台任务。
- **IM 与邮件触达**：支持微信、企业微信、钉钉、飞书/Lark、QQ 和邮箱。
- **本地数据与权限控制**：会话、配置和任务元数据保存在本地 SQLite 中，高风险工具调用需要审批。

## 工作原理

<p align="center">
  <img src="public/readme/rongxinai_architecture_zh.svg" alt="知远智能体架构" width="760">
</p>

知远智能体使用 Electron 严格进程隔离架构。Renderer 承载 React UI，Preload 通过 `contextBridge` 暴露受控 IPC，Main Process 负责 Agent 会话、本地推理生命周期、本地存储、技能系统、MCP 接入和消息网关。

## 快速开始

### 环境要求

- Node.js `>=24 <25`
- Bun `>=1.3`（包管理器；所有脚本也可用 `npm run` 等价执行）

### 本地开发

```bash
git clone https://github.com/rongxinzy/RongxinAI.git 知远智能体
cd 知远智能体
bun install
bun run electron:dev
```

默认 Vite 开发服务器地址为 `http://localhost:5175`。

### 开发环境下使用本地推理服务

```bash
# 下载本地推理运行时
bun run llamacpp:runtime:download
# 准备 Agent 运行时并启动开发环境
bun run electron:dev:openclaw

bun run electron:dev
```

## 构建与打包

```bash
bun run build              # TypeScript 类型检查 + Vite 生产构建
bun run lint               # oxlint 代码检查
bun run format             # oxfmt 格式化（检查：bun run format:check）
bun test                   # Vitest 单元测试
bun run compile:electron   # 仅编译 Electron 主进程
```

平台打包：

```bash
bun run dist:mac
bun run dist:win
bun run dist:linux
```

桌面安装包会内置 Agent 运行时。本地推理由应用内脚本独立管理对应运行时。

## 主要模块

### Cowork

Cowork 是核心会话系统。用户任务从 Renderer 通过 IPC 发送到 Main Process，再交给内置 Agent 运行时执行。消息、权限请求、工具状态和完成事件会实时流回 UI。

会话列表和工作目录以 Workspace 为主归属，Agent 仅作为创建会话时的角色快照。Workspace、历史会话迁移、Expert prompt 隔离以及恢复规则详见：[Workspace 会话模型重构说明](WORKSPACE_SESSION_REFACTOR.zh-CN.md)。

关键流式事件：

| 事件                | 说明             |
| ------------------- | ---------------- |
| `message`           | 会话新增消息     |
| `messageUpdate`     | 流式内容增量更新 |
| `permissionRequest` | 工具调用需要审批 |
| `complete`          | 会话执行完成     |
| `error`             | 会话执行失败     |

### 本地推理

本地推理工作台用于管理应用托管的推理服务、本地 GGUF 模型、基于 ModelScope 的模型市场，以及每个模型的启动参数，例如上下文长度、GPU offload 层数、线程数、批大小、主 GPU、内存映射和 keep-alive。

如果在服务配置里设置了 `modelsDir`，则以自定义目录为准。

### 技能与 MCP

`SKILLs/` 目录包含内置技能，`SKILLs/skills.config.json` 控制默认启停与排序。MCP 设置用于接入 GitHub、浏览器、数据库、文件系统以及企业内部服务等外部工具。

常见内置技能：

| 技能                             | 用途              |
| -------------------------------- | ----------------- |
| `web-search`                     | 搜索与资料收集    |
| `docx` / `xlsx` / `pptx` / `pdf` | Office 与文档处理 |
| `playwright`                     | 浏览器自动化      |
| `remotion`                       | 视频生成          |
| `imap-smtp-email`                | 邮件收发          |
| `stock-*`                        | 投研与公告检索    |
| `skill-creator`                  | 自定义技能创建    |

### 定时任务

定时任务既可以通过自然语言创建，也可以在 GUI 中配置。任务触发后，知远智能体会启动 Cowork 会话执行，并将结果保留在桌面端；如配置了通知渠道，还可以投递到 IM 或邮件。

## 技术栈

| 层           | 技术                             |
| ------------ | -------------------------------- |
| 桌面框架     | Electron 40                      |
| 前端         | React 19 + TypeScript 7          |
| 构建         | Vite 8（Rolldown）               |
| 样式         | Tailwind CSS 4                   |
| 工具链       | Bun（包管理器）、oxlint、oxfmt   |
| 状态管理     | Redux Toolkit                    |
| Agent 运行时 | 全栈自研                         |
| 本地推理     | 全栈自研（GGUF 模型）            |
| 存储         | better-sqlite3                   |
| 渲染         | react-markdown / Mermaid / KaTeX |

## License

[MIT License](LICENSE)
