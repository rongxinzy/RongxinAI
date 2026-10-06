/**
 * CI regression lane: replay the recorded 32-document long task against the
 * full adapter stack with no live model. The tape server answers every
 * provider request from tests/replay/tapes/longtask-32doc.jsonl.gz with
 * strict seq+hash matching, so any drift in prompt assembly, tool wiring,
 * gating, stall handling, or run completion fails here.
 *
 * Re-record intentionally (AB_LONGTASK=record vitest run of
 * tests/abLongTask.harness.test.ts) when the scenario or prompts change.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { LONGTASK_DOC_COUNT, runLongTaskScenario } from './replay/piLongTaskScenario';

const TAPE_PATH = path.resolve(__dirname, 'replay/tapes/longtask-32doc.jsonl.gz');
const WORK_DIR = path.join(os.tmpdir(), 'pi-longtask-replay-work');
const HARD_CAP_MS = 15 * 60 * 1000;

// Path normalization is POSIX-shaped; Windows runs should re-record first.
describe.skipIf(process.platform === 'win32')('Pi long-task replay (recorded provider)', () => {
  it(
    'completes the recorded 32-document task without drift',
    { timeout: HARD_CAP_MS + 120_000 },
    async () => {
      const summary = await runLongTaskScenario({
        mode: 'replay',
        workDir: WORK_DIR,
        tapePath: TAPE_PATH,
        tapeDebugDumpDir: path.join(os.tmpdir(), 'pi-longtask-replay-dump'),
        hardCapMs: HARD_CAP_MS,
      });

      expect(summary.tape?.misses, summary.tape?.missReport).toBe(0);
      expect(summary.tape?.consumed).toBe(summary.tape?.total);
      expect(summary.outcome.status).toBe('complete');
      expect(summary.errors).toEqual([]);
      expect(summary.counts.byType['agent_settled']).toBe(1);
      expect(summary.counts.byType['turn_start']).toBeGreaterThanOrEqual(LONGTASK_DOC_COUNT);
      expect(summary.workbenchTaskStatus).toBe('needs_review');

      // The golden run completed the full 32-document read/summarize loop
      // plus index.csv and report.md; artifact assertions anchor the
      // stack-level invariants, while the strict seq+hash tape match guards
      // against any request-level regression.
      for (const [name, size] of Object.entries(summary.artifacts)) {
        expect(size, `${name} should exist`).not.toBeNull();
      }

      const summaries = fs.readFileSync(path.join(WORK_DIR, 'summaries.md'), 'utf8');
      expect(summaries.match(/^## doc-/gm)?.length).toBe(LONGTASK_DOC_COUNT);
      const csvLines = fs
        .readFileSync(path.join(WORK_DIR, 'index.csv'), 'utf8')
        .split('\n')
        .filter(line => line.trim().length > 0);
      expect(csvLines.length).toBe(LONGTASK_DOC_COUNT + 1);
    },
  );
});
