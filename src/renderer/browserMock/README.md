# Browser preview mock

`bun run web:preview` serves the renderer in a plain browser. With no preload bridge,
`main.tsx` dynamically imports `installMock.ts` (behind `import.meta.env.DEV`, so production
bundles never contain this folder) and installs `browserMockElectron` as `window.electron`.

- `generated/` — emitted by `scripts/preview/generate-browser-mock.ts` from `IElectronAPI`.
  Every method exists. Unimplemented calls warn once and return a typed default; `on*`
  methods subscribe to `runtime.ts`. Do not edit these files. Regenerate with
  `bun run web:preview:codegen`.
- `interactive.ts` — fixture-backed sessions, a streamed mock reply, skills, MCP, scheduled
  tasks, local inference, and dialogs. These replace generated methods and do not warn.
- `fixtures/` — sessions, messages, workspaces, skills, MCP servers, agents, and config.
- `installMock.ts` — installs the mock when `window.electron` is missing.

`bun run web:preview:check` walks the main screens in light and dark and fails on console
errors. See AGENTS.md.
