# Browser Mock

Mock implementation of the Electron `window.electron` API for browser preview mode.

## Purpose

Enable full renderer preview in a plain browser (Vite dev server) without Electron, for:

- Fast UI iteration without waiting for Electron to start
- Visual testing and screenshot capture with Playwright
- Component development and design review
- Accessibility testing

## Architecture

### Entry Points

- **`detectEnvironment.ts`**: Detects whether we're running in Electron or browser
- **`installMock.ts`**: Conditionally installs the mock into `window.electron`
- **`index.ts`**: Main mock implementation with all IPC API surfaces

### Fixtures

Fixture files in `fixtures/` provide realistic test data:

- **`coworkFixtures.ts`**: Sessions, messages, workspaces, and config
- **`skillsFixtures.ts`**: Skills list, marketplace, and content
- **`mcpFixtures.ts`**: MCP servers and marketplace
- **`localInferenceFixtures.ts`**: llama.cpp and Ollama status, models, preferences
- **`scheduledTasksFixtures.ts`**: Tasks, runs, channels
- **`appFixtures.ts`**: App info, API config, agents, memory, todos

### Type Safety

The mock uses the same types as the real preload bridge:

- IPC channel constants from `@shared/ipc/channels`
- Type imports from `@shared/*` modules
- Contract types ensure mock stays in sync with preload

When the preload API changes, TypeScript will report errors in the mock, forcing updates.

## Activation

The mock is only active when:

1. Running in development mode (`import.meta.env.DEV`)
2. AND `window.electron` is undefined (browser, not Electron)

Production builds and Electron runs never load the mock code.

## Usage

### Standard Workflow

```bash
# Start browser preview mode
npm run web:preview

# Open http://localhost:5176
# Navigate through the app, all screens render with mock data
```

### Testing with Playwright

```bash
# Install Playwright browsers (first time only)
npx playwright install

# Start the preview server in one terminal
npm run web:preview

# Run the tests in another terminal
npx playwright test tests/browserPreview.test.ts

# View screenshots
ls docs/browser-preview-screenshots/
```

## Maintenance

When adding new IPC APIs to `src/main/preload.ts`:

1. Add mock implementation to `src/renderer/browserMock/index.ts`
2. Add fixture data to relevant `fixtures/*.ts` file
3. TypeScript will enforce the correct signature
4. Test that affected screens render correctly

## Limitations

The mock provides:

- ✅ All API methods with realistic return values
- ✅ Event listeners (push notifications) with no-op implementations
- ✅ Fixture data that exercises all UI states
- ✅ Type safety via shared contracts

The mock does NOT provide:

- ❌ Real filesystem access
- ❌ Real SQLite database
- ❌ Real subprocess execution
- ❌ Real model inference
- ❌ Real network calls to external services

For integration testing that requires real backend behavior, use Electron mode (`npm run electron:dev`).
