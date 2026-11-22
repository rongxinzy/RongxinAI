import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'node:child_process';
import * as XLSX from 'xlsx';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  resolveSkillScriptPath,
  runManagedSkillScript,
  startManagedSkillProcess,
} from './skillRuntimeRunner';
import { getSkillsRoot } from './coworkUtil';

vi.mock('./anysearchGatewayCredentials', () => ({
  resolveAnySearchGateway: () => ({
    url: 'https://search.example.invalid',
    token: 'fixture-search-authorization',
  }),
}));

describe('skillRuntimeRunner', () => {
  const roots: string[] = [];

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === 'win32').each(['abort', 'timeout'] as const)(
    'reaps descendants when a managed Skill script reaches %s',
    async trigger => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-runtime-tree-'));
      roots.push(root);
      const scriptDir = path.join(root, 'fixture', 'scripts');
      fs.mkdirSync(scriptDir, { recursive: true });
      const ready = path.join(root, 'child.pid');
      fs.writeFileSync(
        path.join(scriptDir, 'tree.mjs'),
        `import { spawn } from 'node:child_process';
        spawn(process.execPath, ['-e', \`
          process.on('SIGTERM', () => {});
          require('node:fs').writeFileSync(process.argv[1], String(process.pid));
          setInterval(() => {}, 1000);
        \`, ${JSON.stringify(ready)}], { stdio: 'inherit' });
        setInterval(() => {}, 1000);`,
      );
      const controller = new AbortController();
      const result = runManagedSkillScript({
        skillsRoot: root,
        skillId: 'fixture',
        script: 'scripts/tree.mjs',
        workspaceRoot: root,
        signal: controller.signal,
        timeoutMs: trigger === 'timeout' ? 2_000 : 10_000,
      });
      let pid: number | undefined;
      const isRunning = (id: number) => {
        const state = spawnSync('ps', ['-o', 'stat=', '-p', String(id)], { encoding: 'utf8' });
        return state.status === 0 && !state.stdout.trim().startsWith('Z');
      };
      try {
        await vi.waitFor(() => expect(fs.existsSync(ready)).toBe(true));
        pid = Number(fs.readFileSync(ready, 'utf8'));
        expect(pid).toBeGreaterThan(1);
        expect(isRunning(pid)).toBe(true);
        if (trigger === 'abort') controller.abort();
        await expect(result).resolves.toMatchObject({
          ok: false,
          status: trigger === 'abort' ? 'aborted' : 'timed-out',
        });
        await vi.waitFor(() => expect(isRunning(pid!)).toBe(false));
      } finally {
        controller.abort();
        if (pid && isRunning(pid)) process.kill(pid, 'SIGKILL');
        await result;
      }
    },
  );

  it('keeps script execution inside the selected skill directory', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-runtime-'));
    roots.push(root);
    const skillDir = path.join(root, 'xlsx', 'scripts');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'reader.py'), 'print("ok")\n');

    const valid = await resolveSkillScriptPath(root, 'xlsx', 'scripts/reader.py');
    const realRoot = fs.realpathSync(root);
    expect(valid).toEqual({
      scriptPath: path.join(realRoot, 'xlsx', 'scripts', 'reader.py'),
      skillDir: path.join(realRoot, 'xlsx'),
    });

    const escaped = await resolveSkillScriptPath(root, 'xlsx', '../outside.py');
    expect('errorCode' in escaped && escaped.errorCode).toBe('SKILL_SCRIPT_OUTSIDE_ROOT');
  });

  it('reports a missing script distinctly from a missing runtime', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-runtime-'));
    roots.push(root);
    fs.mkdirSync(path.join(root, 'pdf'), { recursive: true });

    const result = await resolveSkillScriptPath(root, 'pdf', 'scripts/inspect.py');
    expect('errorCode' in result && result.errorCode).toBe('SKILL_SCRIPT_NOT_FOUND');
    expect('error' in result && result.error).toContain('Skill script not found');
  });

  it('returns the script failure and stderr instead of relabeling it as a missing file', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-runtime-'));
    roots.push(root);
    fs.mkdirSync(path.join(root, 'xlsx', 'scripts'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'xlsx', 'scripts', 'reader.mjs'),
      'process.stderr.write("input file is not readable\\n"); process.exit(3);\n',
    );

    const result = await runManagedSkillScript({
      skillsRoot: root,
      skillId: 'xlsx',
      script: 'scripts/reader.mjs',
      workspaceRoot: root,
      timeoutMs: 10_000,
    });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('SKILL_SCRIPT_FAILED');
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain('input file is not readable');
  });

  it('checks the Node Skill script once before running it without a shell command string', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-runtime-'));
    roots.push(root);
    fs.mkdirSync(path.join(root, 'presentation-studio', 'scripts'), { recursive: true });
    const script = path.join(root, 'presentation-studio', 'scripts', 'probe.mjs');
    fs.writeFileSync(script, 'process.stdout.write(process.argv.slice(2).join("|"));\n');
    const canonicalScript = await fs.promises.realpath(script);
    const realpath = vi.spyOn(fs.promises, 'realpath');

    const result = await runManagedSkillScript({
      skillsRoot: root,
      skillId: 'presentation-studio',
      script: 'scripts/probe.mjs',
      args: ['a b', 'c'],
      workspaceRoot: root,
      timeoutMs: 10_000,
    });
    expect(result.ok).toBe(true);
    expect(result.runtime).toBe('node');
    expect(result.stdout).toBe('a b|c');
    expect(realpath.mock.calls.filter(([candidate]) => candidate === canonicalScript)).toHaveLength(
      1,
    );
  });

  it('starts a long-lived Skill after the same path check', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-runtime-process-'));
    roots.push(root);
    const skillDir = path.join(root, 'fixture');
    fs.mkdirSync(skillDir);
    fs.writeFileSync(
      path.join(skillDir, 'serve.mjs'),
      'process.stdout.write("ready"); setInterval(() => {}, 1000);',
    );
    const process = await startManagedSkillProcess({
      skillId: 'fixture',
      script: 'serve.mjs',
      skillsRoot: root,
      workspaceRoot: root,
    });
    try {
      await expect(process.waitForOutput(stdout => stdout === 'ready', 3_000)).resolves.toEqual({
        stdout: 'ready',
        stderr: '',
      });
      expect(process.isRunning()).toBe(true);
    } finally {
      await process.stop();
    }
  });

  it('routes the bundled search skill through the native gateway and leaves shadow scripts alone', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-runtime-search-'));
    roots.push(root);
    fs.writeFileSync(path.join(root, 'query.txt'), '  现有实现  \n');
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        data: { results: [{ title: 'Source', url: 'https://example.com/source' }] },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const options = {
      skillId: 'web-search',
      script: 'scripts/search.mjs',
      workspaceRoot: root,
      args: ['@query.txt', '20'],
    };
    const bundled = await runManagedSkillScript({ ...options, skillsRoot: getSkillsRoot() });
    expect(bundled).toMatchObject({ ok: true, command: null });
    expect(bundled.stdout).toContain(
      '**URL:** [https://example.com/source](https://example.com/source)',
    );
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      'https://search.example.invalid/v1/search',
      expect.objectContaining({
        body: JSON.stringify({ query: '现有实现', max_results: 20 }),
        headers: expect.objectContaining({ authorization: 'Bearer fixture-search-authorization' }),
      }),
    );
    expect(JSON.stringify(bundled)).not.toContain('fixture-search-authorization');

    const shadow = path.join(root, 'web-search', 'scripts');
    fs.mkdirSync(shadow, { recursive: true });
    fs.writeFileSync(path.join(shadow, 'search.mjs'), 'process.stdout.write("shadow ran");');
    expect(await runManagedSkillScript({ ...options, skillsRoot: root })).toMatchObject({
      ok: true,
      stdout: 'shadow ran',
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    ['x'.repeat(501), '10'],
    ['query', '2extra'],
  ])('rejects invalid bundled search input before calling the gateway', async (query, count) => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ data: { results: [] } }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await runManagedSkillScript({
      skillsRoot: getSkillsRoot(),
      skillId: 'web-search',
      script: 'scripts/search.mjs',
      args: [query, count],
      workspaceRoot: getSkillsRoot(),
    });
    expect(result).toMatchObject({ ok: false, errorCode: 'SKILL_SCRIPT_FAILED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('bounds captured stdout and reports truncation', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-runtime-output-'));
    roots.push(root);
    fs.mkdirSync(path.join(root, 'xlsx', 'scripts'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'xlsx', 'scripts', 'noisy.mjs'),
      'process.stdout.write("😀".repeat(400_000));\n',
    );

    const result = await runManagedSkillScript({
      skillsRoot: root,
      skillId: 'xlsx',
      script: 'scripts/noisy.mjs',
      workspaceRoot: root,
      timeoutMs: 10_000,
    });
    expect(result.ok).toBe(true);
    expect(Buffer.byteLength(result.stdout, 'utf8')).toBeLessThanOrEqual(1024 * 1024);
    expect(result.stdoutTruncated).toBe(true);
    expect(result.stdout).not.toContain('\uFFFD');
  });

  it('does not report truncation when stdout exactly reaches the capture limit', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-runtime-output-limit-'));
    roots.push(root);
    fs.mkdirSync(path.join(root, 'xlsx', 'scripts'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'xlsx', 'scripts', 'exact-limit.mjs'),
      'process.stdout.write("x".repeat(1024 * 1024));\n',
    );

    const result = await runManagedSkillScript({
      skillsRoot: root,
      skillId: 'xlsx',
      script: 'scripts/exact-limit.mjs',
      workspaceRoot: root,
      timeoutMs: 10_000,
    });
    expect(result.ok).toBe(true);
    expect(Buffer.byteLength(result.stdout, 'utf8')).toBe(1024 * 1024);
    expect(result.stdoutTruncated).toBe(false);
  });

  it('reads an XLSX file through the packaged Skill Python environment', async () => {
    const skillsRoot = path.resolve(process.cwd(), 'SKILLs');
    const packagedEnvironment = path.resolve(process.cwd(), 'resources', 'skill-python', 'xlsx');
    if (!fs.existsSync(packagedEnvironment)) return;

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-runtime-xlsx-'));
    roots.push(root);
    const inputPath = path.join(root, 'sample.xlsx');
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ['Name', 'Score'],
        ['Alice', 98],
      ]),
      'Scores',
    );
    XLSX.writeFile(workbook, inputPath);

    const result = await runManagedSkillScript({
      skillsRoot,
      skillId: 'xlsx',
      script: 'scripts/xlsx_reader.py',
      args: [inputPath, '--json'],
      workspaceRoot: root,
      timeoutMs: 30_000,
    });
    expect(result.ok).toBe(true);
    expect(result.runtime).toBe('python');
    expect(result.stdout).toContain('Scores');
    expect(result.stdout).toContain('Alice');
  });

  it('creates a simple DOCX through the managed Node fallback', async () => {
    const skillsRoot = path.resolve(process.cwd(), 'SKILLs');

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-runtime-docx-'));
    roots.push(root);
    const inputPath = path.join(root, 'content.md');
    const outputPath = path.join(root, 'content.docx');
    fs.writeFileSync(inputPath, '\uFEFF# Managed DOCX\n\nCreated through the Pi Skill runner.\n');

    const result = await runManagedSkillScript({
      skillsRoot,
      skillId: 'docx',
      script: 'scripts/markdown_to_docx.mjs',
      args: [inputPath, outputPath],
      workspaceRoot: root,
      timeoutMs: 30_000,
    });
    expect(result.ok).toBe(true);
    expect(result.runtime).toBe('node');
    expect(fs.statSync(outputPath).size).toBeGreaterThan(0);

    const preview = await runManagedSkillScript({
      skillsRoot,
      skillId: 'docx',
      script: 'scripts/docx_preview.mjs',
      args: [outputPath],
      workspaceRoot: root,
      timeoutMs: 30_000,
    });
    expect(preview.ok).toBe(true);
    expect(preview.stdout).toContain('Managed DOCX');
    expect(preview.stdout).not.toContain('DOCX .');
  });

  it('renders PDF previews with the packaged PDF Skill environment', async () => {
    const sourceRoot = path.resolve(process.cwd(), 'SKILLs', 'pdf');
    const requirementsPath = path.join(sourceRoot, 'requirements.txt');
    const packagedEnvironment = path.resolve(process.cwd(), 'resources', 'skill-python', 'pdf');
    if (!fs.existsSync(requirementsPath) || !fs.existsSync(packagedEnvironment)) return;

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-runtime-pdf-'));
    roots.push(root);
    const skillDir = path.join(root, 'pdf');
    const scriptDir = path.join(skillDir, 'scripts');
    fs.mkdirSync(scriptDir, { recursive: true });
    fs.copyFileSync(requirementsPath, path.join(skillDir, 'requirements.txt'));
    fs.copyFileSync(
      path.join(sourceRoot, 'scripts', 'pdf_preview.py'),
      path.join(scriptDir, 'pdf_preview.py'),
    );
    fs.writeFileSync(
      path.join(scriptDir, 'create_pdf.py'),
      [
        'import sys',
        'from reportlab.pdfgen import canvas',
        'document = canvas.Canvas(sys.argv[1])',
        'document.drawString(72, 720, "Managed PDF")',
        'document.save()',
      ].join('\n'),
    );
    const inputPath = path.join(root, 'input.pdf');
    const outputDir = path.join(root, 'preview');

    const create = await runManagedSkillScript({
      skillsRoot: root,
      skillId: 'pdf',
      script: 'scripts/create_pdf.py',
      args: [inputPath],
      workspaceRoot: root,
      timeoutMs: 30_000,
    });
    expect(create.ok).toBe(true);

    const preview = await runManagedSkillScript({
      skillsRoot: root,
      skillId: 'pdf',
      script: 'scripts/pdf_preview.py',
      args: [inputPath, '--output', outputDir],
      workspaceRoot: root,
      timeoutMs: 30_000,
    });
    expect(preview.ok).toBe(true);
    expect(preview.runtime).toBe('python');
    expect(fs.statSync(path.join(outputDir, 'page-001.png')).size).toBeGreaterThan(0);
    expect(fs.statSync(path.join(outputDir, 'contact-sheet.png')).size).toBeGreaterThan(0);
  });

  it('compiles a PowerPoint deck directly through the managed Electron Node path', async () => {
    const skillsRoot = path.resolve(process.cwd(), 'SKILLs');
    const presentationRoot = path.join(skillsRoot, 'presentation-studio');
    if (!fs.existsSync(path.join(presentationRoot, 'node_modules', 'pptxgenjs'))) return;

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-runtime-ppt-'));
    roots.push(root);
    const pagesDir = path.join(root, 'pages');
    const outputDir = path.join(root, 'output');
    fs.mkdirSync(pagesDir, { recursive: true });
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(
      path.join(root, 'deck.json'),
      JSON.stringify({
        title: 'Managed deck',
        canvas: { width: 1280, height: 720 },
        theme: {
          colors: { background: '#101820', text: '#FFFFFF', accent: '#F2AA4C' },
          textStyles: { title: { fontSize: 34, fontFace: 'Arial', color: '$text', bold: true } },
        },
        pages: ['pages/01-cover.json'],
      }),
    );
    fs.writeFileSync(
      path.join(pagesDir, '01-cover.json'),
      JSON.stringify({
        pageType: 'cover',
        background: '$background',
        elements: [
          {
            id: 'title',
            type: 'text',
            bounds: [96, 240, 720, 80],
            style: '$title',
            text: 'Managed deck',
          },
        ],
      }),
    );

    const compile = await runManagedSkillScript({
      skillsRoot,
      skillId: 'presentation-studio',
      script: 'scripts/compile-deck.mjs',
      args: [path.join(root, 'deck.json'), path.join(outputDir, 'presentation.pptx')],
      workspaceRoot: root,
      timeoutMs: 30_000,
    });
    expect(compile.ok).toBe(true);
    expect(fs.statSync(path.join(outputDir, 'presentation.pptx')).size).toBeGreaterThan(0);
  });
});
