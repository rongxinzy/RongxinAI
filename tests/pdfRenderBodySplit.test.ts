import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { test } from 'vitest';

const scriptsDir = path.resolve(__dirname, '..', 'SKILLs', 'pdf', 'scripts');

const MODULES = [
  'render_body.py',
  'body_flowables.py',
  'body_styles.py',
  'body_png.py',
  'body_blocks.py',
] as const;

/** All block kinds the story builder must dispatch on. */
const ALL_BLOCK_KINDS = [
  'h1',
  'h2',
  'h3',
  'body',
  'bullet',
  'numbered',
  'callout',
  'table',
  'image',
  'figure',
  'code',
  'math',
  'chart',
  'flowchart',
  'bibliography',
  'divider',
  'caption',
  'pagebreak',
  'spacer',
] as const;

/** Every block kind except "numbered" resets the numbered-list counter. */
const RESETS_NUMBERED = ALL_BLOCK_KINDS.filter(k => k !== 'numbered');

/** ParagraphStyle keys produced by make_styles. */
const STYLE_KEYS = [
  'h1',
  'h2',
  'h3',
  'body',
  'bullet',
  'numbered',
  'callout',
  'caption',
  'table_header',
  'table_cell',
  'code',
  'code_lang',
  'bib',
  'bib_title',
  'math_fallback',
  'eq_label',
] as const;

const astProbe = `
import ast, json, os, sys

def walk_statements(nodes):
    for node in nodes:
        yield node
        if isinstance(node, (ast.Try, ast.If, ast.With, ast.AsyncWith, ast.For, ast.While)):
            yield from walk_statements(node.body)
            yield from walk_statements(getattr(node, 'orelse', []) + getattr(node, 'finalbody', []))

def top_level_names(tree):
    names = []
    for node in walk_statements(tree.body):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            names.append(node.name)
        elif isinstance(node, ast.Assign):
            names.extend(ast.unparse(t) for t in node.targets)
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            for a in node.names:
                names.append(a.asname or a.name.split('.')[0])
    return names

def imported_names(tree):
    names = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            for a in node.names:
                names.append(a.asname or a.name)
    return names

def kind_dispatch(tree, func):
    kinds = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == func:
            for sub in ast.walk(node):
                if isinstance(sub, ast.Compare):
                    for side in (sub.left, *sub.comparators):
                        if isinstance(side, ast.Name) and side.id == 'kind':
                            for other in (sub.left, *sub.comparators):
                                if isinstance(other, ast.Constant) and isinstance(other.value, str):
                                    kinds.add(other.value)
    return sorted(kinds)

def frozenset_literal(tree, name):
    for node in tree.body:
        if isinstance(node, ast.Assign):
            targets = [ast.unparse(t) for t in node.targets]
            if name in targets and isinstance(node.value, ast.Call):
                fn = node.value.func
                if isinstance(fn, ast.Name) and fn.id == 'frozenset':
                    el = node.value.args[0]
                    return sorted(e.value for e in el.elts)
    return None

def returned_dict_keys(tree, func):
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == func:
            for sub in ast.walk(node):
                if isinstance(sub, ast.Return) and isinstance(sub.value, ast.Dict):
                    return sorted(
                        k.value for k in sub.value.keys
                        if isinstance(k, ast.Constant) and isinstance(k.value, str)
                    )
    return None

out = {}
for fpath in sys.argv[1:]:
    with open(fpath, encoding='utf-8') as fh:
        tree = ast.parse(fh.read())
    out[os.path.basename(fpath)] = {
        'top_level': top_level_names(tree),
        'imported': imported_names(tree),
        'kinds': kind_dispatch(tree, 'build_story'),
        'resets': frozenset_literal(tree, '_RESETS_NUMBERED'),
        'style_keys': returned_dict_keys(tree, 'make_styles'),
    }
print(json.dumps(out))
`;

interface AstFacts {
  top_level: string[];
  imported: string[];
  kinds: string[];
  resets: string[] | null;
  style_keys: string[] | null;
}

function probeAst(): Record<string, AstFacts> {
  const stdout = execFileSync(
    'python3',
    ['-c', astProbe, ...MODULES.map(m => path.join(scriptsDir, m))],
    {
      encoding: 'utf-8',
    },
  );
  return JSON.parse(stdout);
}

test('render_body split modules compile and stay under the line cap', () => {
  for (const mod of MODULES) {
    execFileSync('python3', ['-m', 'py_compile', path.join(scriptsDir, mod)], { stdio: 'pipe' });
    const lineCount = readFileSync(path.join(scriptsDir, mod), 'utf-8').split('\n').length;
    assert.ok(lineCount <= 1000, `${mod} has ${lineCount} lines`);
  }
});

test('render_body.py re-exports the full legacy module surface', () => {
  const facts = probeAst();
  const facade = facts['render_body.py'];

  // Names formerly defined in render_body.py must resolve via its imports.
  const legacySymbols = [
    'register_fonts',
    'make_styles',
    'CalloutBox',
    'BibliographyItem',
    'BeautifulDoc',
    '_image_from_bytes',
    '_render_math_png',
    '_render_chart_png',
    '_render_flowchart_png',
    '_divider',
    '_add_heading',
    '_add_body',
    '_add_bullet',
    '_add_numbered',
    '_add_callout',
    '_add_table',
    '_add_image',
    '_add_figure',
    '_add_code',
    '_add_math',
    '_add_chart',
    '_add_flowchart',
    '_add_bibliography',
    '_RESETS_NUMBERED',
    'build_story',
    'build',
    'main',
  ];
  for (const sym of legacySymbols) {
    assert.ok(facade.top_level.includes(sym), `render_body.py no longer exposes ${sym}`);
  }

  // Implementation modules must own the symbols the facade re-exports.
  const owners: Record<string, string[]> = {
    'body_flowables.py': ['CalloutBox', 'BibliographyItem', 'BeautifulDoc'],
    'body_styles.py': ['register_fonts', 'make_styles'],
    'body_png.py': [
      '_image_from_bytes',
      '_render_math_png',
      '_render_chart_png',
      '_render_flowchart_png',
    ],
    'body_blocks.py': [
      '_divider',
      '_add_heading',
      '_add_body',
      '_add_bullet',
      '_add_numbered',
      '_add_callout',
      '_add_table',
      '_add_image',
      '_add_figure',
      '_add_code',
      '_add_math',
      '_add_chart',
      '_add_flowchart',
      '_add_bibliography',
      '_RESETS_NUMBERED',
      'build_story',
    ],
  };
  for (const [mod, symbols] of Object.entries(owners)) {
    for (const sym of symbols) {
      assert.ok(facts[mod].top_level.includes(sym), `${mod} does not define ${sym}`);
    }
  }

  // New modules must not import the facade back (no circular imports).
  for (const mod of MODULES) {
    if (mod === 'render_body.py') continue;
    assert.ok(!facts[mod].imported.includes('render_body'), `${mod} imports render_body`);
  }
});

test('build_story still dispatches every documented block kind and resets numbering', () => {
  const facts = probeAst();
  const blocks = facts['body_blocks.py'];

  assert.deepEqual([...blocks.kinds].sort(), [...ALL_BLOCK_KINDS].sort());
  assert.deepEqual([...(blocks.resets ?? [])].sort(), [...RESETS_NUMBERED].sort());
});

test('make_styles still produces the full style set', () => {
  const facts = probeAst();
  assert.deepEqual([...(facts['body_styles.py'].style_keys ?? [])].sort(), [...STYLE_KEYS].sort());
});

test('render_body.py keeps the missing-reportlab guard (exit 2) when the dep is absent', () => {
  const hasReportlab =
    spawnSync('python3', ['-c', 'import reportlab'], { encoding: 'utf-8' }).status === 0;
  const run = spawnSync('python3', [path.join(scriptsDir, 'render_body.py'), '--help'], {
    encoding: 'utf-8',
  });

  if (hasReportlab) {
    assert.equal(run.status, 0);
  } else {
    assert.equal(run.status, 2);
    assert.match(run.stderr, /Missing reportlab\. Run through make\.sh/);
  }
});
