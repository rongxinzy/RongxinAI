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
    const workspace = path.dirname(path.dirname(path.dirname(run.runDirectory)));
    fs.writeFileSync(path.join(workspace, 'academic-report.md'), '# Academic research report');
    fs.writeFileSync(path.join(workspace, 'academic-report-qa.md'), 'Claims and sources checked.');
    expect(run.recordFile('academic-report.md', 'deliverable')).toContain('Verified');
    expect(run.recordFile('academic-report-qa.md', 'validation')).toContain('Verified');
    run.recordSubagentStart('research-1', { agent: 'researcher', task: 'retrieve literature' });

    let decision = run.onAgentEnd();
    expect(decision.shouldFinish).toBe(false);
    run.recordSubagentStart('research-2', { agent: 'researcher', task: 'seek contrary evidence' });
    decision = run.onAgentEnd();
    expect(decision.shouldFinish).toBe(false);
    run.recordSubagentStart('research-3', { agent: 'researcher', task: 'compare methodologies' });

    run.requestCompletion('All conclusions are documented.');
    decision = run.onAgentEnd();
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
      iteration: 4,
      review: { requested: false, passed: false },
      completionFailures: expect.arrayContaining([
        'iteration 4 did not launch an isolated researcher',
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

  it('keeps an unfinished run on the same iteration when no researcher launched', () => {
    const run = createRun();
    const decision = run.onAgentEnd();
    expect(decision.shouldFinish).toBe(false);
    expect(decision.nextPrompt).toContain('must launch an isolated researcher');
    expect(decision.nextPrompt).toContain('was not advanced');
    expect(run.getSnapshot()).toMatchObject({ iteration: 1, staleCount: 1 });

    run.recordSubagentStart('research-retry', { agent: 'researcher', task: 'retry iteration' });
    expect(run.onAgentEnd().shouldFinish).toBe(false);
    expect(run.getSnapshot()).toMatchObject({ iteration: 2 });
    expect(MIN_RESEARCH_SUBQUESTIONS).toBe(3);
  });

  it('returns an early completion request to research mode instead of deadlocking in review', () => {
    const run = createRun();
    run.recordSubagentStart('research-1', { agent: 'researcher', task: 'start discovery' });
    run.requestCompletion('Finished too early.');

    const decision = run.onAgentEnd();

    expect(decision.shouldFinish).toBe(false);
    expect(decision.nextPrompt).toContain('Completion deferred');
    expect(decision.nextPrompt).toContain('fewer than 3 research iterations');
    expect(run.getSnapshot()).toMatchObject({ status: 'running', iteration: 2 });
  });

  it('does not accept research evidence without a durable report and QA record', () => {
    const run = createRun();
    run.requestCompletion('Evidence is collected.');

    const decision = run.onAgentEnd();

    expect(decision.shouldFinish).toBe(false);
    expect(decision.nextPrompt).toContain('no verified final research report is recorded');
    expect(decision.nextPrompt).toContain('no verified research validation report is recorded');
  });

  it('rejects research artifacts outside the workspace or with the wrong type', () => {
    const run = createRun();
    const workspace = path.dirname(path.dirname(path.dirname(run.runDirectory)));
    fs.writeFileSync(path.join(workspace, 'notes.txt'), 'not the final report');

    expect(run.recordFile('../outside.md', 'deliverable')).toContain('inside the selected workspace');
    expect(run.recordFile('notes.txt', 'deliverable')).toContain('expects one of');
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
