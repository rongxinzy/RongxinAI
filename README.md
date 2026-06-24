# LEO

<p align="center">
  <img src="public/logo.png" alt="LEO" width="120">
</p>

<p align="center">
  <strong>An all-in-one local AI Agent workspace powered by OpenClaw and llama.cpp</strong>
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
  English | <a href="README_zh.md">中文</a>
</p>

---

LEO is the official English product name of 李知远智能体, an AI Agent workspace by 北京容芯致远 for development, research, automation, and personal productivity. It combines the OpenClaw runtime, llama.cpp local inference, built-in skills, MCP integrations, scheduled tasks, and IM or email reachability in one application.

LEO is not just a chat UI. It is an execution environment where an Agent can work on your machine, request approval for sensitive tools, manage local GGUF models, run recurring tasks, and stay reachable from desktop and mobile channels.

## Key Features

- **Cowork agent workflows**: Run multi-step tasks with file tools, shell commands, browser automation, document processing, and approval-gated actions.
- **llama.cpp local inference**: Manage local GGUF models, configure `llama-server`, and connect local models to Agent workflows.
- **Model marketplace**: Search GGUF models from ModelScope and install them into the app-managed llama.cpp directory.
- **Skills and MCP**: Use built-in skills and connect external tools or internal services through MCP.
- **Scheduled tasks**: Create recurring jobs for briefings, follow-ups, inbox cleanup, reports, and other background work.
- **IM and email channels**: Reach the Agent through WeChat, WeCom, DingTalk, Feishu/Lark, QQ, and email.
- **Local data and permission control**: Sessions, config, and task metadata stay in local SQLite; risky tool calls require approval.

## How It Works

<p align="center">
  <img src="public/readme/rongxinai_architecture_en.svg" alt="LEO architecture" width="760">
</p>

LEO uses Electron with strict process isolation. The Renderer hosts the React UI, Preload exposes controlled IPC through `contextBridge`, and the Main Process manages OpenClaw sessions, llama.cpp lifecycle, local storage, skills, MCP integrations, and messaging gateways.

## Quick Start

### Requirements

- Node.js `>=24 <25`
- npm

### Local Development

```bash
git clone https://github.com/rongxinzy/RongxinAI.git RongxinAI
cd RongxinAI
npm install
npm run electron:dev
```

The current repository name remains `RongxinAI` for compatibility.

The Vite dev server runs at `http://localhost:5175` by default.

### Develop With OpenClaw And llama.cpp

```bash
npm run electron:dev:openclaw
```

This command ensures the pinned OpenClaw runtime, prepares the llama.cpp runtime for the current host, and starts the Electron development app.

Useful OpenClaw build variables:

| Variable | Description |
| --- | --- |
| `OPENCLAW_SRC` | Path to the local OpenClaw source directory |
| `OPENCLAW_FORCE_BUILD=1` | Force an OpenClaw runtime rebuild |
| `OPENCLAW_SKIP_ENSURE=1` | Skip automatic OpenClaw version checkout |

## Build And Package

```bash
npm run build
npm run lint
npm test
npm run compile:electron
```

Platform packages:

```bash
npm run dist:mac
npm run dist:win
npm run dist:linux
```

The packaged desktop app includes the required OpenClaw runtime. The local inference stack uses llama.cpp and manages its runtime separately through the app scripts.

## Core Modules

### Cowork

Cowork is the primary session system. A task is sent from the Renderer to the Main Process through IPC, then dispatched to OpenClaw. Messages, permission requests, tool state, and completion events stream back to the UI in real time.

Key stream events:

| Event | Description |
| --- | --- |
| `message` | A new message enters the session |
| `messageUpdate` | Incremental streaming content update |
| `permissionRequest` | A tool call requires approval |
| `complete` | The session has finished |
| `error` | The session failed |

### llama.cpp Local Inference

The local inference workspace manages the app-owned `llama-server` process, local GGUF models, the ModelScope-backed marketplace, and per-model launch parameters such as context length, GPU offload layers, threads, batch size, main GPU, memory mapping, and keep-alive.

Current default local model path (legacy directory name retained for compatibility):

- macOS: `~/Library/Application Support/RongxinAI/models/llamacpp`
- Windows: `%APPDATA%\\RongxinAI\\models\\llamacpp`

If `modelsDir` is configured in the service settings, the custom path takes precedence.

### Skills And MCP

The `SKILLs/` directory contains built-in skills, and `SKILLs/skills.config.json` controls default enablement and ordering. MCP settings connect external tool services such as GitHub, browsers, databases, file systems, and internal enterprise systems.

Common built-in skills:

| Skill | Purpose |
| --- | --- |
| `web-search` | Search and research |
| `docx` / `xlsx` / `pptx` / `pdf` | Office and document processing |
| `playwright` | Browser automation |
| `remotion` | Video generation |
| `imap-smtp-email` | Email send and receive |
| `stock-*` | Investment research and announcements |
| `skill-creator` | Custom skill creation |

### Scheduled Tasks

Scheduled tasks can be created from natural language or through the GUI. When a task runs, LEO starts a Cowork session, keeps the result in the desktop app, and can optionally deliver notifications through configured IM or email channels.

## Tech Stack

| Layer | Technology |
| --- | --- |
| Desktop | Electron 40 |
| Frontend | React 18 + TypeScript |
| Build | Vite 5 |
| Styling | Tailwind CSS |
| State | Redux Toolkit |
| Agent runtime | OpenClaw |
| Local models | llama.cpp |
| Storage | better-sqlite3 |
| Rendering | react-markdown / Mermaid / KaTeX |

## License

[MIT License](LICENSE)
