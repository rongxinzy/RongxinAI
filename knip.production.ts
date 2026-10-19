import type { KnipConfig } from 'knip';

import baseConfig from './knip';

/**
 * Production-mode companion to `knip.ts`, scoped to application source.
 *
 * Knip's vitest plugin makes every `*.test.ts` an entry file, so a production
 * module imported only by its own tests counts as used and plain `knip` stays
 * green (this is how `src/main/harness/boundaryPolicy.ts` went unnoticed).
 * Knip's `--production` mode ignores test entries, but it only honors entry and
 * project patterns suffixed with `!`, and it stops treating npm scripts as
 * entries. This config therefore restricts the analysis to `src/`: files that
 * ship in the Electron bundles plus `src/**` as project files.
 *
 * `bun run knip:production` reports production modules, exports and
 * dependencies that are unreachable without tests. Plain `bun run knip` remains
 * the superset check covering scripts and test-only code. CI runs the files
 * rule only; every `ignoreIssues` entry below must carry a reason and be
 * removed once its follow-up lands.
 */
const config: KnipConfig = {
  compilers: baseConfig.compilers,
  workspaces: {
    '.': {
      entry: [
        // vite-plugin-electron bundle entries. Knip's Vite plugin does not read
        // the electron() entry list in vite.config.ts, and production mode does
        // not take entry patterns from the base config, so list them here.
        'src/main/main.ts!',
        'src/main/preload.ts!',
        'src/main/llamacppModelDaemonEntry.ts!',
        'src/main/workbenchTask/artifactWorker.ts!',
        'src/main/magpie/catalogWorker.ts!',
        'src/main/magpie/hashWorker.ts!',
        'src/main/libs/appUpdateHashWorker.ts!',
        'src/main/pythonRuntime/runner.ts!',
        // Spawned by path.join(__dirname, '...js'), not a static import.
        'src/main/extensions/aisphere/requestWorker.ts!',
        // Renderer workers constructed with `new Worker(new URL(..., import.meta.url))`.
        'src/renderer/components/artifacts/renderers/csvPreview.worker.ts!',
        'src/renderer/components/artifacts/renderers/dxfPreview.worker.ts!',
        // Invoked by `bun run theme:generate` / `theme:audit`, not imported.
        'src/renderer/theme/scripts/generate-css.ts!',
        'src/renderer/theme/scripts/audit-styles.ts!',
      ],
      // Renderer UI sources are reachable from index.html, which the Vite
      // plugin supplies as an entry in normal mode; carry that over here.
      project: ['src/**/*.{ts,tsx,css}!'],
    },
  },
  ignoreBinaries: baseConfig.ignoreBinaries,
  ignoreDependencies: baseConfig.ignoreDependencies,
  ignoreIssues: {
    ...baseConfig.ignoreIssues,
    // Test infrastructure whose naming (*.testHarness.ts, __tests__/*.ts,
    // fixtures.ts) production mode does not recognize as test files.
    'src/main/codingAgent/codingRoomServiceTestHarness.ts': ['files'],
    'src/main/coworkStore/coworkStore.testHarness.ts': ['files'],
    'src/main/libs/agentEngine/piRuntimeAdapter.testHarness.ts': ['files'],
    'src/main/im/__tests__/**': ['files'],
    'src/scheduledTask/fixtures.ts': ['files'],
    // Pending user decision (architecture review work package A.7): the legacy
    // scheduled-task surface. The classic theme definitions were removed (N.2,
    // #1169) and their entries retired with them.
    'src/scheduledTask/metaStore.ts': ['files'],
    'src/scheduledTask/modelMapper.ts': ['files'],
    'src/scheduledTask/origin.ts': ['files'],
    'src/scheduledTask/policies/**': ['files'],
    // Not yet triaged; production reachability unverified. Follow-up items —
    // each must be either wired into production code or deleted, then removed
    // from this list.
    'src/main/evaluation/**': ['files'],
    'src/main/memory/goldenEvaluation.ts': ['files'],
    'src/main/libs/agentModels.ts': ['files'],
    'src/main/libs/gatewayLogRotation.ts': ['files'],
    'src/main/magpie/managementPolicy.ts': ['files'],
    'src/renderer/components/cowork/directChatSnapshot.ts': ['files'],
    'src/renderer/components/cowork/hooks/useConversationRailScrollSync.ts': ['files'],
    'src/renderer/components/expert/presetExpertLabels.ts': ['files'],
    'src/renderer/components/expert/PresetExpertList.tsx': ['files'],
    'src/renderer/components/localInference/components/ModelCapabilitySettingsModal.tsx': ['files'],
    'src/renderer/components/localInference/utils/logFormatting.ts': ['files'],
    'src/renderer/services/directChatTurnState.ts': ['files'],
    'src/renderer/services/modelCapabilityProbe.ts': ['files'],
    'src/renderer/services/thinkingMessageLifecycle.ts': ['files'],
    'src/renderer/utils/adaptiveTextReveal.ts': ['files'],
    'src/renderer/utils/debounce.ts': ['files'],
    'src/renderer/utils/streamingMarkdownSegments.ts': ['files'],
  },
  tags: baseConfig.tags,
  ignoreUnresolved: baseConfig.ignoreUnresolved,
};

export default config;
