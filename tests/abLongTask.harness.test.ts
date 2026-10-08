/**
 * A/B long-task experiment — manual live/record/replay-debug driver for the
 * shared long-task scenario (tests/replay/piLongTaskScenario.ts).
 *
 * - AB_LONGTASK=live:             full adapter stack against the real provider.
 * - AB_LONGTASK=record:           same, with the tape server teeing every provider
 *                                 request/response into tests/replay/tapes/longtask-32doc.jsonl.gz
 *                                 (re-record intentionally when prompts or the scenario change;
 *                                 set AB_LONGTASK_UPSTREAM_API_KEY when the endpoint
 *                                 requires a bearer token, AB_LONGTASK_UPSTREAM to
 *                                 override the recorded origin).
 * - AB_LONGTASK=replay-sequential: debug mode — replays the tape ignoring hash
 *                                 mismatches (warns per seq) to separate benign
 *                                 drift from real divergence.
 *
 * Never runs in CI (skipped unless AB_LONGTASK is set).
 */

import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { runLongTaskScenario } from './replay/piLongTaskScenario';

const MODE = process.env.AB_LONGTASK;
const TAPE_PATH = path.resolve(__dirname, 'replay/tapes/longtask-32doc.jsonl.gz');
const WORK_DIR = path.join(os.tmpdir(), 'pi-longtask-replay-work');
const HARD_CAP_MS = 180 * 60 * 1000;

describe.skipIf(!MODE || MODE === '0')('A/B long-task manual driver', () => {
  it(
    `runs the 32-document long task in ${MODE ?? 'unknown'} mode`,
    { timeout: HARD_CAP_MS + 60_000 },
    async () => {
      const mode = MODE === 'record' ? 'record' : MODE?.startsWith('replay') ? 'replay' : 'live';
      const summary = await runLongTaskScenario({
        mode,
        workDir: WORK_DIR,
        tapePath: mode === 'live' ? undefined : TAPE_PATH,
        tapeMatchMode: MODE === 'replay-sequential' ? 'sequential' : 'strict',
        tapeDumpAllRequestsDir:
          MODE === 'replay-dump' ? path.join(os.tmpdir(), 'pi-longtask-request-dump') : undefined,
        hardCapMs: HARD_CAP_MS,
      });
      console.log('summary:', JSON.stringify(summary, null, 2).slice(0, 4000));
      expect(summary.outcome.status).toBe('complete');
    },
  );
});
