/**
 * CI regression lane: replay the aimock-recorded 32-document long task against
 * the full adapter stack with no live model. Fixtures under
 * tests/replay/generated/aimock-longtask match requests semantically
 * (message content, tool rounds), so prompt drift does not void the run;
 * a behavioral divergence still fails artifact acceptance.
 *
 * Re-record intentionally with:
 *   AB_LONGTASK=record AB_PROVIDER=aimock AB_LONGTASK_MODEL=<gateway-model> \
 *   AB_LONGTASK_UPSTREAM=<gateway> AB_LONGTASK_UPSTREAM_API_KEY=<token> \
 *   bunx vitest run tests/abLongTask.harness.test.ts
 */

import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { LONGTASK_DOC_COUNT, runLongTaskScenario } from './replay/piLongTaskScenario';
import { inspectLongTaskArtifacts } from './replay/piLongTaskAcceptance';

const FIXTURES_DIR = path.resolve(__dirname, 'replay/generated/aimock-longtask');
const WORK_DIR = path.join(os.tmpdir(), 'pi-longtask-aimock-work');
const HARD_CAP_MS = 15 * 60 * 1000;

describe('Pi long-task replay (aimock fixtures)', () => {
  it(
    'completes the recorded 32-document task',
    { timeout: HARD_CAP_MS + 120_000 },
    async () => {
      const summary = await runLongTaskScenario({
        mode: 'replay',
        provider: 'aimock',
        aimockFixturesDir: FIXTURES_DIR,
        workDir: WORK_DIR,
        hardCapMs: HARD_CAP_MS,
      });

      expect(summary.outcome.status).toBe('complete');
      expect(summary.errors).toEqual([]);
      expect(summary.counts.byType['agent_settled']).toBe(1);
      expect(summary.counts.byType['turn_start']).toBeGreaterThanOrEqual(LONGTASK_DOC_COUNT);
      expect(summary.workbenchTaskStatus).toBe('settled');
      for (const [name, size] of Object.entries(summary.artifacts)) {
        expect(size, `${name} should exist`).not.toBeNull();
      }
      expect(inspectLongTaskArtifacts(WORK_DIR, LONGTASK_DOC_COUNT)).toEqual([]);
    },
  );
});
