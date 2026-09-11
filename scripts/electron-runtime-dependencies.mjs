export const ELECTRON_MAIN_EXTERNALS = [
  '@agentclientprotocol/sdk',
  '@firecrawl/anydoc',
  'better-sqlite3',
  'bufferutil',
  'node-pty',
  'utf-8-validate',
];

export const ELECTRON_RUNTIME_DEPENDENCIES = [
  '@agentclientprotocol/claude-agent-acp',
  '@agentclientprotocol/codex-acp',
  '@agentclientprotocol/sdk',
  '@earendil-works/pi-agent-core',
  '@earendil-works/pi-ai',
  '@earendil-works/pi-coding-agent',
  '@earendil-works/pi-tui',
  '@firecrawl/anydoc',
  '@mariozechner/clipboard',
  'ajv',
  'ajv-formats',
  'better-sqlite3',
  'bufferutil',
  'debug',
  'electron-updater',
  'google-auth-library',
  // The SoL-Pi runtime loads its vendored extension tree through jiti inside
  // the packaged Electron main process; the vendored tree's bare imports
  // (@earendil-works/* and typebox) must therefore resolve from the archive's
  // node_modules as production dependencies.
  'jiti',
  'node-pty',
  'npm',
  'pako',
  'typebox',
  'utf-8-validate',
];
