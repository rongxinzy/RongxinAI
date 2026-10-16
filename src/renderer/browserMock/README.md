# Browser preview mock

`bun run web:preview` serves the renderer in a plain browser. With no preload bridge,
`main.tsx` dynamically imports `installMock.ts` (behind `import.meta.env.DEV`, so production
bundles never contain this folder) and installs `browserMockElectron` as `window.electron`.

- `index.ts` — typed overrides (`DeepPartial<Window['electron']>`) plus a fallback proxy:
  `onX` subscriptions return a no-op unsubscribe, every other unmocked call resolves to
  `{ success: false, error: 'Not available in browser preview' }`.
- `fixtures/index.ts` — sessions, messages, workspaces, skills, MCP servers, agents and config.
  Fixture types are derived from the preload contract, so contract changes surface as type errors.
- `installMock.ts` — installs the mock when `window.electron` is missing.

To support a new screen, add a typed override for the IPC calls it needs in `index.ts`.
Screenshots: `bun run preview:screenshots [outDir]` against a running preview.
