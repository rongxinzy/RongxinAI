import * as fs from 'fs';
import * as os from 'os';
import path from 'path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MIN_RESEARCH_SUBQUESTIONS,
  MIN_VERIFIED_SOURCES,
  PiResearchRunController,
  ResearchSourceType,
} from './piResearchRun';

const tempRoots: string[] = [];

const createRun = (): PiResearchRunController => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-research-run-'));
  tempRoots.push(root);
  return new PiResearchRunController({
    sessionId: 'session-1',
    workspaceRoot: root,
    task: 'Study test topic',
  });
};

afterEach(() => {
  vi.unstubAllGlobals();
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('PiResearchRunController', () => {
  it('creates Deli-compatible durable state files and reloads them for the same session', () => {
    const run = createRun();
    expect(fs.existsSync(path.join(run.runDirectory, 'state', 'task_spec.md'))).toBe(true);
    expect(fs.existsSync(path.join(run.runDirectory, 'state', 'progress.json'))).toBe(true);
    expect(fs.existsSync(path.join(run.runDirectory, 'state', 'findings.jsonl'))).toBe(true);
    expect(fs.existsSync(path.join(run.runDirectory, 'state', 'directions_tried.json'))).toBe(true);
    expect(fs.existsSync(path.join(run.runDirectory, 'logs', 'heartbeat.jsonl'))).toBe(true);

    run.setPlan(['scope', 'evidence', 'limitations']);
    run.addDirection('primary literature');
    const restored = new PiResearchRunController({
      sessionId: 'session-1',
      workspaceRoot: path.dirname(path.dirname(path.dirname(run.runDirectory))),
      task: 'ignored after restore',
    });
    expect(restored.getSnapshot()).toMatchObject({
      subquestions: expect.arrayContaining([expect.objectContaining({ id: 'q1' })]),
      directionsTried: ['primary literature'],
    });
  });

  it('does not approve completion until an independent reviewer and every evidence gate pass', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    const run = createRun();
    run.setPlan(['scope', 'evidence', 'limitations']);
    run.addDirection('primary literature');
    run.addDirection('contrary findings');
    run.addDirection('methodology comparison');

    const urls = Array.from(
      { length: MIN_VERIFIED_SOURCES },
      (_, index) => `https://source-${index}.example.test/paper`,
    );
    for (const [index, url] of urls.entries()) {
      await run.verifySource(
        url,
        index < 2 ? ResearchSourceType.Primary : ResearchSourceType.Secondary,
      );
    }
    run.addClaim('claim-1', 'q1', 'The scoped result is supported.', urls.slice(0, 2));
    run.addClaim('claim-2', 'q2', 'The evidence converges across sources.', urls.slice(2, 4));
    run.addClaim('claim-3', 'q3', 'The limitations are explicitly bounded.', urls.slice(4, 6));
    run.setContradictionCheck('Conflicting results are scoped by population and publication date.');
    run.recordSubagentStart('research-1', { agent: 'researcher', task: 'retrieve literature' });

    run.requestCompletion('All conclusions are documented.');
    let decision = run.onAgentEnd();
    expect(decision.shouldFinish).toBe(false);
    expect(decision.nextPrompt).toContain('isolated reviewer');

    run.recordSubagentStart('review-1', { agent: 'reviewer', task: 'audit evidence' });
    run.recordSubagentResult('unrelated-researcher', 'REVIEW_VERDICT: PASS', false);
    decision = run.onAgentEnd();
    expect(decision.shouldFinish).toBe(false);

    run.recordSubagentResult('review-1', 'Do not return REVIEW_VERDICT: PASS yet.', false);
    decision = run.onAgentEnd();
    expect(decision.shouldFinish).toBe(false);

    run.recordSubagentStart('review-2', { agent: 'reviewer', task: 'audit corrected evidence' });
    run.recordSubagentResult('review-2', 'REVIEW_VERDICT: PASS', false);
    decision = run.onAgentEnd();
    expect(decision).toMatchObject({ shouldFinish: true });

    run.resumeForPrompt('Investigate a follow-up question.');
    expect(run.getSnapshot()).toMatchObject({
      status: 'running',
      task: 'Investigate a follow-up question.',
      iteration: 2,
      review: { requested: false, passed: false },
      completionFailures: expect.arrayContaining([
        'iteration 2 did not launch an isolated researcher',
      ]),
    });
  });

  it('clears claims when the research plan changes and requires auditable claim text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    const run = createRun();
    run.setPlan(['scope', 'evidence', 'limitations']);
    await run.verifySource('https://one.example.test/paper', ResearchSourceType.Primary);
    await run.verifySource('https://two.example.test/paper', ResearchSourceType.Primary);

    expect(
      run.addClaim('claim-1', 'q1', '', [
        'https://one.example.test/paper',
        'https://two.example.test/paper',
      ]),
    ).toContain('statement is empty');
    expect(
      run.addClaim('claim-1', 'q1', 'A supported statement.', [
        'https://one.example.test/paper',
        'https://two.example.test/paper',
      ]),
    ).toContain('Recorded claim');

    run.setPlan(['new scope', 'new evidence', 'new limitations']);
    expect(run.getSnapshot()).toMatchObject({ claims: [] });
  });

  it('keeps an unfinished run alive and raises stale_count when an iteration launched no researcher', () => {
    const run = createRun();
    const decision = run.onAgentEnd();
    expect(decision.shouldFinish).toBe(false);
    expect(decision.nextPrompt).toContain('must launch an isolated researcher');
    expect(run.getSnapshot()).toMatchObject({ iteration: 2, staleCount: 1 });
    expect(MIN_RESEARCH_SUBQUESTIONS).toBe(3);
  });

  it('does not fetch local or private source URLs', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const run = createRun();

    await expect(
      run.verifySource('http://127.0.0.1/admin', ResearchSourceType.Primary),
    ).resolves.toContain('local, private');
    await expect(
      run.verifySource('http://169.254.169.254/latest/meta-data', ResearchSourceType.Primary),
    ).resolves.toContain('local, private');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
