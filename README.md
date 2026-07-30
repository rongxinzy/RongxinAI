# ZhiYuan Agent — Open-source, local-first desktop AI agent

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/zhiyuan-logo-dark-1600.png">
    <img src="public/zhiyuan-logo-light-1600.png" alt="ZhiYuan Agent" width="120">
  </picture>
</p>

<p align="center">
  <strong>An AI agent that works with your files, terminal, browser, skills, MCP tools, and local models — on your computer.</strong>
</p>

<p align="center">
  <a href="https://github.com/rongxinzy/RongxinAI/stargazers"><img src="https://img.shields.io/github/stars/rongxinzy/RongxinAI?style=for-the-badge&logo=github&label=Stars" alt="GitHub Stars"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL%20v3-red.svg?style=for-the-badge" alt="GNU AGPL v3 License"></a>
  <img src="https://img.shields.io/badge/Platform-macOS%20%7C%20Windows%20%7C%20Linux-brightgreen?style=for-the-badge" alt="Platform">
</p>

<p align="center">
  <a href="https://www.rongxzyai.com/">Website & download</a> ·
  <a href="#quick-start-for-developers">Quick start</a> ·
  <a href="#how-zhiyuan-agent-works">Architecture</a> ·
  <a href="README_zh.md">中文</a>
</p>

<p align="center">
  <img src="public/readme/zhiyuan-ppt-demo.gif" alt="ZhiYuan Agent creating an introductory AI presentation from a natural-language request" width="960">
</p>

ZhiYuan Agent is an open-source, local-first desktop AI agent built by Beijing Rongxin Zhiyuan for development, research, automation, and everyday knowledge work. It is not another chat wrapper: the agent can execute multi-step tasks on your machine, show its progress, and pause for approval before sensitive actions.

Its agent runtime and GGUF inference engine are developed in-house. The desktop app brings execution, local models, 40+ built-in skills, MCP integrations, recurring tasks, and IM or email delivery into one workspace.

## Why ZhiYuan: a local-first AI agent that can act

| What you need | What ZhiYuan does |
| --- | --- |
| Work completed, not just suggested | Reads and writes files, runs terminal commands, operates a browser, and produces documents |
| Control over sensitive actions | Shows tool state and requests per-action approval before high-risk operations |
| A private local-model option | Installs and runs GGUF models with configurable context, GPU offload, threads, and lifecycle |
| Reusable workflows | Combines 40+ bundled skills, custom skills, MCP services, and scheduled tasks |
| Results beyond the desktop | Delivers completed work through WeChat, WeCom, DingTalk, Feishu/Lark, QQ, or email |

Typical use cases include repository research, document and spreadsheet work, browser-based operations, recurring briefings, inbox cleanup, local-model experiments, and internal tool automation.

## Download ZhiYuan Agent

Download the latest release from the [official website](https://www.rongxzyai.com/#download):

- Windows 10/11 (x64)
- macOS (Apple silicon)
- Linux (build from source)

If you find ZhiYuan useful, consider giving the repository a star.

## Key features

- **Cowork agent workflows**: Run multi-step tasks with file tools, shell commands, browser automation, document processing, and approval-gated actions.
- **Local GGUF inference**: Manage models, tune the inference service, and connect local models to agent workflows.
- **Model marketplace**: Search GGUF models from ModelScope and install them into the app-managed model directory.
- **Skills and MCP**: Use 40+ bundled skills, create your own, and connect external tools or internal services through MCP.
- **Scheduled tasks**: Create recurring briefings, follow-ups, inbox cleanup, reports, and other background work.
- **Messaging and email channels**: Reach the agent through WeChat, WeCom, DingTalk, Feishu(Lark), QQ, and email.
- **Local data and permission control**: Sessions, configuration, and task metadata stay in local SQLite; sensitive tool calls require approval.

## How ZhiYuan Agent works

<p align="center">
  <img src="public/readme/rongxinai_architecture_en.svg" alt="ZhiYuan Agent architecture" width="760">
</p>

ZhiYuan Agent uses Electron with strict process isolation. The renderer hosts the React UI, preload exposes controlled IPC through `contextBridge`, and the main process manages agent sessions, local inference, storage, skills, MCP integrations, scheduled tasks, and messaging gateways.

### Cowork agent runtime

A task moves from the renderer through controlled IPC to the built-in agent runtime. Messages, permission requests, tool state, and completion events stream back to the UI in real time.

| Event | Description |
| --- | --- |
| `message` | A new message enters the session |
| `messageUpdate` | Incremental streaming content update |
| `permissionRequest` | A tool call requires approval |
| `complete` | The session has finished |
| `error` | The session failed |

### Local inference and model marketplace

The local inference workspace manages the app-owned service, GGUF models, the ModelScope-backed marketplace, and per-model settings such as context length, GPU offload layers, threads, batch size, main GPU, memory mapping, and keep-alive.

### Skills, MCP, and automation

`SKILLs/` contains the bundled skills, while `SKILLs/skills.config.json` controls default enablement and ordering. MCP settings connect external tool services such as GitHub, browsers, databases, file systems, and internal enterprise systems.

Scheduled tasks can be created with natural language or through the GUI. A run starts a Cowork session, stores its result in the desktop app, and can deliver a notification through a configured IM or email channel.

## Quick start for developers

### Requirements

- Git
- Node.js `24.x`
- Bun `1.3+`

On Windows, native dependency builds may also require:

- Python 3
- Visual Studio Build Tools with **Desktop development with C++**

### Run locally

```bash
git clone https://github.com/rongxinzy/RongxinAI.git
cd RongxinAI
bun install
bun run electron:dev
```

To prepare the bundled agent runtime and local inference runtime before starting Electron:

```bash
bun run electron:dev:openclaw
```

### Build, test, and package

```bash
bun run build              # TypeScript typecheck + Vite production build
bun run lint               # oxlint
bun run format:check       # oxfmt
bun test                   # Vitest
bun run compile:electron   # Electron main process only

bun run dist:mac
bun run dist:win
bun run dist:linux
```

## Tech stack

| Layer | Technology |
| --- | --- |
| Desktop | Electron 40 |
| Frontend | React 19, TypeScript 7 |
| Build | Vite 8 (Rolldown) |
| Styling | Tailwind CSS 4 |
| Tooling | Bun, oxlint, oxfmt |
| State | Redux Toolkit |
| Agent runtime | Self-developed |
| Local inference | Self-developed, GGUF-compatible |
| Storage | better-sqlite3 |
| Rendering | react-markdown, Mermaid, KaTeX |

## Contributing

Bug reports, feature requests, and pull requests are welcome.

- [Report a bug](https://github.com/rongxinzy/RongxinAI/issues/new?template=bug_report.yml)
- [Request a feature](https://github.com/rongxinzy/RongxinAI/issues/new?template=feature_request.yml)
- Read the [contributing guide](CONTRIBUTING.md) before opening a pull request

## Sponsors

Special thanks to [AnySearch](https://github.com/anysearch-ai) for supporting the built-in web search capability. See the implementation in [`SKILLs/web-search`](SKILLs/web-search) before leaving the repository for the sponsor site.

## License

ZhiYuan Agent is licensed under the [GNU Affero General Public License v3.0](LICENSE).
