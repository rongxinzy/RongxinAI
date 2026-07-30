import * as fs from 'fs';
import * as os from 'os';
import path from 'path';
import JSZip from 'jszip';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PiShortcutWorkflowController,
  resolveShortcutWorkflowKind,
  ShortcutWorkflowKind,
} from './piShortcutWorkflow';

const roots: string[] = [];
const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAF/gL+ONo+9QAAAABJRU5ErkJggg==',
  'base64',
);

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
    expect(resolveShortcutWorkflowKind(['presentation-studio'])).toBe(ShortcutWorkflowKind.Ppt);
    expect(resolveShortcutWorkflowKind(['deep-research', 'web-search'])).toBe(
      ShortcutWorkflowKind.DeepResearch,
    );
    expect(resolveShortcutWorkflowKind(['docx'])).toBe(ShortcutWorkflowKind.Docs);
    expect(resolveShortcutWorkflowKind(['frontend-design'])).toBe(ShortcutWorkflowKind.Website);
    expect(resolveShortcutWorkflowKind(['xlsx'])).toBe(ShortcutWorkflowKind.Sheets);
  });

  it('keeps a PPT workflow active until its deliverable, QA report, and preview are verified', async () => {
    const run = createRun(ShortcutWorkflowKind.Ppt);
    run.requestCompletion('looks finished');
    expect(run.onAgentEnd()).toMatchObject({
      shouldFinish: false,
      nextPrompt: expect.stringContaining('Missing requirements'),
    });

    const root = rootFor(run);
    const archive = new JSZip();
    archive.file('[Content_Types].xml', '<Types />');
    archive.file('ppt/presentation.xml', '<p:presentation />');
    archive.file('ppt/slides/slide1.xml', '<p:sld />');
    fs.writeFileSync(
      path.join(root, 'deck.pptx'),
      await archive.generateAsync({ type: 'nodebuffer' }),
    );
    fs.writeFileSync(path.join(root, 'qa.md'), 'Checked text and fixed the title overflow.');
    fs.writeFileSync(path.join(root, 'slide-1.png'), onePixelPng);
    await expect(run.recordFile('deck.pptx', 'deliverable')).resolves.toContain('Verified');
    await expect(run.recordFile('qa.md', 'validation')).resolves.toContain('Verified');
    await expect(run.recordFile('slide-1.png', 'preview')).resolves.toContain('Verified');

    run.requestCompletion('all checks passed');
    expect(run.onAgentEnd()).toMatchObject({ shouldFinish: true });
  });

  it('rejects a claimed Office output that is not a complete Office package', async () => {
    const run = createRun(ShortcutWorkflowKind.Docs);
    fs.writeFileSync(path.join(rootFor(run), 'report.docx'), 'PK\x03\x04not a real package');
    await expect(run.recordFile('report.docx', 'deliverable')).resolves.toContain(
      'not a valid ZIP package',
    );
  });

  it('keeps deep research active until a cited report, QA record, plan, researchers, and reachable sources are recorded', async () => {
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
    run.recordSubagentStart('research-call', {
      parallel: [
        { agent: 'researcher', task: 'definitions' },
        { agent: 'researcher', task: 'data' },
        { agent: 'researcher', task: 'counterevidence' },
      ],
    });
    run.recordSubagentResult(
      'research-call',
      [
        '3/3 subagents succeeded.',
        '## researcher (ok)\ndefinitions',
        '## researcher (ok)\ndata',
        '## researcher (ok)\ncounterevidence',
      ].join('\n\n'),
      false,
    );
    for (let index = 0; index < 6; index += 1) {
      await run.verifySource(`https://source-${index}.example.test/report`);
    }
    const root = rootFor(run);
    fs.writeFileSync(path.join(root, 'report.md'), '# Report\n\n[1] https://source-0.example.test/report');
    fs.writeFileSync(path.join(root, 'research-qa.md'), 'Checked citations, scope, and unresolved gaps.');
    await run.recordFile('report.md', 'deliverable');
    await run.recordFile('research-qa.md', 'validation');
    run.requestCompletion('report is supported');
    expect(run.onAgentEnd()).toMatchObject({ shouldFinish: true });
  });

  it('rejects deep-research completion when evidence exists but no durable report is recorded', () => {
    const run = createRun(ShortcutWorkflowKind.DeepResearch);
    run.requestCompletion('sources are enough');
    expect(run.onAgentEnd()).toMatchObject({
      shouldFinish: false,
      nextPrompt: expect.stringContaining('no verified deliverable file is recorded'),
    });
  });

  it('requires a rendered preview for Docs, Website, and Sheets workflows', () => {
    for (const kind of [
      ShortcutWorkflowKind.Docs,
      ShortcutWorkflowKind.Website,
      ShortcutWorkflowKind.Sheets,
    ]) {
      const run = createRun(kind);
      run.requestCompletion('looks done');
      expect(run.onAgentEnd()).toMatchObject({
        shouldFinish: false,
        nextPrompt: expect.stringContaining('no inspected rendered preview is recorded'),
      });
    }
  });

  it('rejects arbitrary files used as validation reports or rendered previews', async () => {
    const run = createRun(ShortcutWorkflowKind.Website);
    const root = rootFor(run);
    fs.writeFileSync(path.join(root, 'qa.sh'), '#!/bin/sh\ntrue');
    fs.writeFileSync(path.join(root, 'preview.txt'), 'not an image');
    fs.writeFileSync(path.join(root, 'renamed-text.png'), 'not an image');
    await expect(run.recordFile('qa.sh', 'validation')).resolves.toContain('expects one of');
    await expect(run.recordFile('preview.txt', 'preview')).resolves.toContain('expects one of');
    await expect(run.recordFile('renamed-text.png', 'preview')).resolves.toContain(
      'not a valid raster image',
    );
  });

  it('does not count failed researcher starts as completed research', () => {
    const run = createRun(ShortcutWorkflowKind.DeepResearch);
    run.recordSubagentStart('failed-call', {
      parallel: [
        { agent: 'researcher', task: 'one' },
        { agent: 'researcher', task: 'two' },
        { agent: 'researcher', task: 'three' },
      ],
    });
    run.recordSubagentResult('failed-call', '0/3 subagents succeeded.', true);
    expect(run.getSnapshot()).toMatchObject({ researcherRuns: 0 });
  });

  it('does not count a failed researcher hidden among successful parallel agents', () => {
    const run = createRun(ShortcutWorkflowKind.DeepResearch);
    run.recordSubagentStart('mixed-call', {
      parallel: [
        { agent: 'researcher', task: 'research' },
        { agent: 'scout', task: 'inspect' },
      ],
    });
    run.recordSubagentResult(
      'mixed-call',
      '1/2 subagents succeeded.\n\n## researcher (failed)\nError: boom\n\n## scout (ok)\nfiles',
      false,
    );
    expect(run.getSnapshot()).toMatchObject({ researcherRuns: 0 });
  });

  it('normalizes source fragments and tracking parameters before counting research evidence', async () => {
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
    await run.verifySource('https://source.example.test/report?utm_source=first#section');
    await run.verifySource('https://source.example.test/report?fbclid=second#other');
    expect(run.getSnapshot()).toMatchObject({
      sources: ['https://source.example.test/report'],
    });
  });

  it('clears old completion evidence before a follow-up task', async () => {
    const run = createRun(ShortcutWorkflowKind.Docs);
    const archive = new JSZip();
    archive.file('[Content_Types].xml', '<Types />');
    archive.file('word/document.xml', '<w:document />');
    fs.writeFileSync(
      path.join(rootFor(run), 'report.docx'),
      await archive.generateAsync({ type: 'nodebuffer' }),
    );
    fs.writeFileSync(path.join(rootFor(run), 'qa.md'), 'validated');
    fs.writeFileSync(path.join(rootFor(run), 'report-preview.png'), onePixelPng);
    await run.recordFile('report.docx', 'deliverable');
    await run.recordFile('qa.md', 'validation');
    await run.recordFile('report-preview.png', 'preview');
    run.requestCompletion('done');
    expect(run.onAgentEnd().shouldFinish).toBe(true);

    run.resumeForPrompt('Create a different report');
    expect(run.getSnapshot()).toMatchObject({
      task: 'Create a different report',
      files: [],
      completionFailures: expect.arrayContaining([
        'no verified deliverable file is recorded',
        'no verification report is recorded',
      ]),
    });
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
