import * as fs from 'fs';
import * as os from 'os';
import path from 'path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PiShortcutWorkflowController,
  resolveShortcutWorkflowKind,
  ShortcutWorkflowKind,
} from './piShortcutWorkflow';

const roots: string[] = [];

const createRun = (kind: ShortcutWorkflowKind): PiShortcutWorkflowController => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-shortcut-workflow-'));
  roots.push(root);
  return new PiShortcutWorkflowController({
    sessionId: 'workflow-1',
    workspaceRoot: root,
    task: 'Create deliverable',
    kind,
  });
};

const rootFor = (run: PiShortcutWorkflowController): string =>
  path.resolve(run.runDirectory, '..', '..', '..');

afterEach(() => {
  vi.unstubAllGlobals();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('PiShortcutWorkflowController', () => {
  it('creates a controlled workflow for every non-academic sidebar shortcut', () => {
    expect(resolveShortcutWorkflowKind(['pptx'])).toBe(ShortcutWorkflowKind.Ppt);
    expect(resolveShortcutWorkflowKind(['deep-research', 'web-search'])).toBe(
      ShortcutWorkflowKind.DeepResearch,
    );
    expect(resolveShortcutWorkflowKind(['docx'])).toBe(ShortcutWorkflowKind.Docs);
    expect(resolveShortcutWorkflowKind(['frontend-design'])).toBe(ShortcutWorkflowKind.Website);
    expect(resolveShortcutWorkflowKind(['xlsx'])).toBe(ShortcutWorkflowKind.Sheets);
  });

  it('keeps a PPT workflow active until its deliverable, QA report, and preview are verified', () => {
    const run = createRun(ShortcutWorkflowKind.Ppt);
    run.requestCompletion('looks finished');
    expect(run.onAgentEnd()).toMatchObject({
      shouldFinish: false,
      nextPrompt: expect.stringContaining('Missing requirements'),
    });

    const root = rootFor(run);
    fs.writeFileSync(path.join(root, 'deck.pptx'), Buffer.from('PK\x03\x04deck'));
    fs.writeFileSync(path.join(root, 'qa.md'), 'Checked text and fixed the title overflow.');
    fs.writeFileSync(path.join(root, 'slide-1.png'), 'preview');
    expect(run.recordFile('deck.pptx', 'deliverable')).toContain('Verified');
    expect(run.recordFile('qa.md', 'validation')).toContain('Verified');
    expect(run.recordFile('slide-1.png', 'preview')).toContain('Verified');

    run.requestCompletion('all checks passed');
    expect(run.onAgentEnd()).toMatchObject({ shouldFinish: true });
  });

  it('rejects a claimed Office output that is not an Office package', () => {
    const run = createRun(ShortcutWorkflowKind.Docs);
    fs.writeFileSync(path.join(rootFor(run), 'report.docx'), 'not a zip');
    expect(run.recordFile('report.docx', 'deliverable')).toContain('not a valid ZIP package');
  });

  it('keeps deep research active until plan, researchers, and reachable sources are recorded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: vi.fn().mockReturnValue(null) },
        body: { cancel: vi.fn() },
      }),
    );
    const run = createRun(ShortcutWorkflowKind.DeepResearch);
    run.setResearchPlan(['definitions', 'primary data', 'counterevidence']);
    run.recordSubagentStart({
      parallel: [
        { agent: 'researcher', task: 'definitions' },
        { agent: 'researcher', task: 'data' },
        { agent: 'researcher', task: 'counterevidence' },
      ],
    });
    for (let index = 0; index < 6; index += 1) {
      await run.verifySource(`https://source-${index}.example.test/report`);
    }
    run.requestCompletion('report is supported');
    expect(run.onAgentEnd()).toMatchObject({ shouldFinish: true });
  });

  it('rejects deep-research redirects to a private target', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 302,
        headers: { get: vi.fn().mockReturnValue('http://127.0.0.1/private') },
        body: { cancel: vi.fn() },
      }),
    );
    const run = createRun(ShortcutWorkflowKind.DeepResearch);
    await expect(run.verifySource('https://public.example.test/redirect')).resolves.toContain(
      'redirect target is local, private, or unsafe',
    );
  });
});
