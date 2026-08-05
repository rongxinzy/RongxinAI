import fs from 'fs';
import os from 'os';
import path from 'path';
import * as XLSX from 'xlsx';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveSkillScriptPath, runManagedSkillScript } from './skillRuntimeRunner';

describe('skillRuntimeRunner', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps script execution inside the selected skill directory', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-runtime-'));
    roots.push(root);
    const skillDir = path.join(root, 'xlsx', 'scripts');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'reader.py'), 'print("ok")\n');

    const valid = resolveSkillScriptPath(root, 'xlsx', 'scripts/reader.py');
    const realRoot = fs.realpathSync(root);
    expect(valid).toEqual({
      scriptPath: path.join(realRoot, 'xlsx', 'scripts', 'reader.py'),
      skillDir: path.join(realRoot, 'xlsx'),
    });

    const escaped = resolveSkillScriptPath(root, 'xlsx', '../outside.py');
    expect('errorCode' in escaped && escaped.errorCode).toBe('SKILL_SCRIPT_OUTSIDE_ROOT');
  });

  it('reports a missing script distinctly from a missing runtime', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-runtime-'));
    roots.push(root);
    fs.mkdirSync(path.join(root, 'pdf'), { recursive: true });

    const result = resolveSkillScriptPath(root, 'pdf', 'scripts/inspect.py');
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

  it('runs a Node Skill script without a shell command string', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-runtime-'));
    roots.push(root);
    fs.mkdirSync(path.join(root, 'presentation-studio', 'scripts'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'presentation-studio', 'scripts', 'probe.mjs'),
      'process.stdout.write(process.argv.slice(2).join("|"));\n',
    );

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
    fs.writeFileSync(
      inputPath,
      '\uFEFF# Managed DOCX\n\nCreated through the Pi Skill runner.\n',
    );

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
      script: 'scripts/docx_preview.sh',
      args: [outputPath],
      workspaceRoot: root,
      timeoutMs: 30_000,
    });
    expect(preview.ok).toBe(true);
    expect(preview.stdout).toContain('Managed DOCX');
    expect(preview.stdout).not.toContain('DOCX .');
  });

  it('runs the PDF inspection pipeline with the packaged PDF Skill environment', async () => {
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
      path.join(sourceRoot, 'scripts', 'pdf_inspect.py'),
      path.join(scriptDir, 'pdf_inspect.py'),
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
    const outputDir = path.join(root, 'inspection');

    const create = await runManagedSkillScript({
      skillsRoot: root,
      skillId: 'pdf',
      script: 'scripts/create_pdf.py',
      args: [inputPath],
      workspaceRoot: root,
      timeoutMs: 30_000,
    });
    expect(create.ok).toBe(true);

    const inspect = await runManagedSkillScript({
      skillsRoot: root,
      skillId: 'pdf',
      script: 'scripts/pdf_inspect.py',
      args: [inputPath, '--output', outputDir],
      workspaceRoot: root,
      timeoutMs: 30_000,
    });
    expect(inspect.ok).toBe(true);
    expect(inspect.runtime).toBe('python');
    expect(fs.existsSync(path.join(outputDir, 'inspection.json'))).toBe(true);
  });

  it('validates and compiles a PowerPoint deck through the managed Electron Node path', async () => {
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

    const validation = await runManagedSkillScript({
      skillsRoot,
      skillId: 'presentation-studio',
      script: 'scripts/validate-deck.mjs',
      args: [
        path.join(root, 'deck.json'),
        '--strict',
        '--json',
        path.join(outputDir, 'validation.json'),
      ],
      workspaceRoot: root,
      timeoutMs: 30_000,
    });
    expect(validation.ok).toBe(true);

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
