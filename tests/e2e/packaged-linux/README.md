# Packaged Linux E2E smoke

Headless smoke for the **packaged** Electron app (not dev `electron .`), using Playwright `_electron`, isolated `userData`, and `xvfb`.

## Prerequisites

- `bun run dist:linux` (produces `release/linux-unpacked/知远`)
- Linux GUI libraries (same set as `.github/workflows/linux-install-pr.yml`)
- `xvfb`
- `sqlite3` CLI (legacy DB seeding/assertions; avoids loading Electron-linked `better-sqlite3` from system Node)
- Optional cloud scenarios: `GLM_API_KEY_1` or `GLM_API_KEY_2` (never logged or committed)
- Local overflow scenario: `node scripts/download-llamacpp-runtime.cjs` (or set `ZHIYUAN_E2E_LLAMACPP_BIN`)

## Run

```bash
bun install
bun run apply:patches
node node_modules/electron/install.js
bun run dist:linux
xvfb-run -a bun run test:e2e:packaged-linux
```

Artifacts: `.github/pr-assets/packaged-linux-e2e/` (`report.json`, PNG screenshots).

## Scenarios

| ID | Needs GLM | Description |
| --- | --- | --- |
| `fresh-start-legacy-tables` | No | Fresh profile must not retain legacy `user_memories` tables |
| `upgrade-legacy-drop` | No | Pre-seeded legacy tables are dropped on startup |
| `managed-memory-engram` | No | Memory IPC create/update/forget + restart persistence |
| `glm-work-memory-tool` | Yes | Work-mode turn using memory tool + recall |
| `im-cc-connect-bridge-reply` | Yes | cc-connect `/v1/cc-connect/turn` receives agent reply (sidecar config + bridge) |
| `llama-overflow-compaction` | No | Import small Qwen GGUF, load with 8k ctx, long work prompt |

Skipped scenarios exit 0 but are recorded as `skip` in `report.json`.
