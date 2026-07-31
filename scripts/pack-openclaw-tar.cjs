'use strict';

/**
 * pack-openclaw-tar.cjs
 *
 * Packs directories into a single .tar file for Windows distribution.
 * NSIS installs thousands of small files very slowly on NTFS; shipping one
 * tar archive and extracting it post-install is dramatically faster.
 *
 * Used by electron-builder-hooks beforePack to pack:
 *   - OpenClaw runtime (vendor/openclaw-runtime/current -> cfmind/)
 *   - SKILLs directory (SKILLs -> SKILLs/)
 *   - Python runtime (resources/python-win -> python-win/)
 *
 * On Windows, uses the built-in tar.exe (C implementation, ~10-20x faster
 * than the JS npm tar module on NTFS).  On other platforms, falls back to
 * npm tar.
 *
 * Usage:
 *   Single dir:      node scripts/pack-openclaw-tar.cjs [sourceDir] [outputTar]
 *   Windows combined: node scripts/pack-openclaw-tar.cjs --win-combined
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// Lazy-loaded — only required when falling back to JS tar (non-Windows)
let tar;

// ── File/dir exclusion rules (same as electron-builder.json filters) ─────────

const EXCLUDED_FILE_PATTERNS = [
  /\.map$/i,
  /\.d\.ts$/i,
  /\.d\.cts$/i,
  /\.d\.mts$/i,
  /^readme(\.(md|txt|rst))?$/i,
  /^changelog(\.(md|txt|rst))?$/i,
  /^history(\.(md|txt|rst))?$/i,
  /^license(\.(md|txt))?$/i,
  /^licence(\.(md|txt))?$/i,
  /^authors(\.(md|txt))?$/i,
  /^contributors(\.(md|txt))?$/i,
  /^\.eslintrc/i,
  /^\.prettierrc/i,
  /^\.editorconfig$/i,
  /^\.npmignore$/i,
  /^\.gitignore$/i,
  /^\.gitattributes$/i,
  /^tsconfig(\..+)?\.json$/i,
  /^jest\.config/i,
  /^vitest\.config/i,
  /^\.babelrc/i,
  /^babel\.config/i,
  /\.test\.\w+$/i,
  /\.spec\.\w+$/i,
];

const EXCLUDED_DIRS = new Set([
  'test',
  'tests',
  '__tests__',
  '__mocks__',
  '.github',
  'example',
  'examples',
  'coverage',
  '.venv',
  '.bin', // node_modules/.bin contains symlinks that break tar on cross-platform builds
]);

const EXCLUDED_ENVFILE = /^\.env(\..+)?$/i;

function shouldExclude(entryPath) {
  const basename = path.basename(entryPath);

  // Check dir exclusion
  const segments = entryPath.split(/[/\\]/);
  for (const seg of segments) {
    if (EXCLUDED_DIRS.has(seg.toLowerCase())) return true;
  }

  // Check file exclusion
  if (EXCLUDED_ENVFILE.test(basename)) return true;
  if (EXCLUDED_FILE_PATTERNS.some(p => p.test(basename))) return true;

  return false;
}

// ── Generate tar --exclude-from file (bsdtar glob patterns) ─────────

function writeExcludeFile(excludeFile) {
  const patterns = [];
  // Excluded directories (anywhere in tree)
  const dirs = [
    'test',
    'tests',
    '__tests__',
    '__mocks__',
    '.github',
    'example',
    'examples',
    'coverage',
    '.venv',
    '.bin',
  ];
  for (const d of dirs) {
    patterns.push(`*/${d}`);
  }

  // Excluded files (by extension)
  const exts = ['.map', '.d.ts', '.d.cts', '.d.mts'];
  for (const ext of exts) {
    patterns.push(`*${ext}`);
  }

  // Excluded file name patterns
  const names = [
    '.env',
    '.env.*',
    '.eslintrc*',
    '.prettierrc*',
    '.editorconfig',
    '.npmignore',
    '.gitignore',
    '.gitattributes',
    'README*',
    'readme*',
    'CHANGELOG*',
    'HISTORY*',
    'LICENSE*',
    'LICENCE*',
    'AUTHORS*',
    'CONTRIBUTORS*',
    'tsconfig*.json',
    'jest.config*',
    'vitest.config*',
    '*.test.*',
    '*.spec.*',
  ];
  for (const n of names) {
    patterns.push(n);
  }

  fs.writeFileSync(excludeFile, patterns.join('\n'), 'utf-8');
  return patterns.length;
}

// ── Pack functions ───────────────────────────────────────────────────────────

/**
 * Pack a single source directory into a tar file (JS fallback for non-Windows).
 * The directory contents are stored under `prefix/` in the tar.
 */
function packSingleSource(sourceDir, outputTar, prefix) {
  if (!tar) tar = require('tar');
  const entries = [];
  let skipped = 0;

  function walk(dir, relPrefix) {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    items.sort((a, b) => a.name.localeCompare(b.name));

    for (const item of items) {
      if (item.isSymbolicLink()) continue;
      const fullPath = path.join(dir, item.name);
      const relPath = relPrefix ? `${relPrefix}/${item.name}` : item.name;

      if (item.isDirectory()) {
        if (EXCLUDED_DIRS.has(item.name.toLowerCase())) {
          skipped++;
          continue;
        }
        walk(fullPath, relPath);
      } else if (item.isFile()) {
        if (shouldExclude(item.name)) {
          skipped++;
          continue;
        }
        entries.push(relPath);
      }
    }
  }

  walk(sourceDir, '');

  tar.create(
    {
      file: outputTar,
      cwd: sourceDir,
      prefix: prefix || '',
      sync: true,
      follow: true,
      filter: filePath => !shouldExclude(filePath),
    },
    fs.readdirSync(sourceDir).filter(name => {
      if (EXCLUDED_DIRS.has(name.toLowerCase())) return false;
      return true;
    }),
  );

  return { totalFiles: entries.length, skipped };
}

/**
 * Pack multiple source directories into a single tar file.
 * Each source gets its own prefix (root directory name) in the tar.
 *
 * On Windows, uses native tar.exe via directory junctions — ~10-20x faster
 * than JS npm tar on NTFS because it avoids thousands of per-file stat/read
 * calls through the JS event loop.
 */
function packMultipleSources(sources, outputTar) {
  const isWindows = process.platform === 'win32';
  let totalFiles = 0;

  if (isWindows) {
    // ── Native tar.exe (Windows) ──
    // Strategy: create a temp staging directory with junctions pointing to
    // each source, then a single tar -cf pass with --exclude-from rules.
    const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-tar-'));
    const excludeFile = path.join(stagingDir, 'exclude.txt');
    const excludeCount = writeExcludeFile(excludeFile);

    const includedPrefixes = [];
    try {
      for (const { dir, prefix } of sources) {
        if (!fs.existsSync(dir)) {
          console.log(`[pack-openclaw-tar]   Skipping ${prefix}: ${dir} not found`);
          continue;
        }

        console.log(`[pack-openclaw-tar]   Adding ${prefix} ← ${dir}`);
        const t0 = Date.now();

        const junctionPath = path.join(stagingDir, prefix);
        // 'junction' type works without admin on Windows (unlike 'dir' symlinks)
        fs.symlinkSync(dir, junctionPath, 'junction');

        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        console.log(`[pack-openclaw-tar]   ${prefix}: junction created in ${elapsed}s`);
        includedPrefixes.push(prefix);
      }

      console.log(
        `[pack-openclaw-tar] Creating tar with tar.exe (${includedPrefixes.join(', ')})...`,
      );
      const tTar = Date.now();

      const tarArgs = [
        '-cf',
        outputTar,
        `--exclude-from=${excludeFile}`,
        '-C',
        stagingDir,
        ...includedPrefixes,
      ];

      execSync(`tar ${tarArgs.map(a => `"${a}"`).join(' ')}`, {
        stdio: 'pipe',
        maxBuffer: 10 * 1024 * 1024,
      });

      const tarElapsed = ((Date.now() - tTar) / 1000).toFixed(1);
      console.log(
        `[pack-openclaw-tar] tar.exe completed in ${tarElapsed}s, ${excludeCount} exclude rules`,
      );
    } finally {
      // Clean up junctions and staging dir
      for (const prefix of includedPrefixes) {
        try {
          fs.unlinkSync(path.join(stagingDir, prefix));
        } catch {}
      }
      try {
        fs.unlinkSync(excludeFile);
      } catch {}
      try {
        fs.rmdirSync(stagingDir);
      } catch {}
    }
  } else {
    // ── JS fallback (non-Windows) ──
    if (!tar) tar = require('tar');

    let first = true;
    for (const { dir, prefix } of sources) {
      if (!fs.existsSync(dir)) {
        console.log(`[pack-openclaw-tar]   Skipping ${prefix}: ${dir} not found`);
        continue;
      }

      console.log(`[pack-openclaw-tar]   Adding ${prefix} ← ${dir}`);
      const t0 = Date.now();

      let sourceFiles = 0;
      const opts = {
        file: outputTar,
        cwd: dir,
        prefix,
        sync: true,
        follow: true,
        filter: filePath => {
          const included = !shouldExclude(filePath);
          if (included) sourceFiles++;
          return included;
        },
      };

      if (first) {
        tar.create(
          opts,
          fs.readdirSync(dir).filter(n => !EXCLUDED_DIRS.has(n.toLowerCase())),
        );
        first = false;
      } else {
        tar.replace(
          opts,
          fs.readdirSync(dir).filter(n => !EXCLUDED_DIRS.has(n.toLowerCase())),
        );
      }

      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`[pack-openclaw-tar]   ${prefix}: ${sourceFiles} entries in ${elapsed}s`);
      totalFiles += sourceFiles;
    }
  }

  return { totalFiles };
}

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
  const projectRoot = path.join(__dirname, '..');
  const isWinCombined = process.argv.includes('--win-combined');

  if (isWinCombined) {
    const outputTar = path.join(projectRoot, 'build-tar', 'win-resources.tar');
    fs.mkdirSync(path.dirname(outputTar), { recursive: true });

    // Remove old tar if exists
    if (fs.existsSync(outputTar)) fs.unlinkSync(outputTar);

    const sources = [
      { dir: path.join(projectRoot, 'vendor', 'openclaw-runtime', 'current'), prefix: 'cfmind' },
      { dir: path.join(projectRoot, 'SKILLs'), prefix: 'SKILLs' },
      { dir: path.join(projectRoot, 'resources', 'python-win'), prefix: 'python-win' },
      { dir: path.join(projectRoot, 'resources', 'uv-win'), prefix: 'uv-win' },
      { dir: path.join(projectRoot, 'resources', 'pandoc'), prefix: 'pandoc' },
    ];

    console.log(`[pack-openclaw-tar] Packing combined Windows tar: ${outputTar}`);
    const t0 = Date.now();
    packMultipleSources(sources, outputTar);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const sizeMB = (fs.statSync(outputTar).size / (1024 * 1024)).toFixed(1);
    console.log(`[pack-openclaw-tar] Done in ${elapsed}s: ${sizeMB} MB`);
    return;
  }

  // Single directory mode
  const sourceDir =
    process.argv[2] || path.join(projectRoot, 'vendor', 'openclaw-runtime', 'current');
  const outputTar =
    process.argv[3] || path.join(projectRoot, 'vendor', 'openclaw-runtime', 'cfmind.tar');

  if (!fs.existsSync(sourceDir)) {
    console.error(`[pack-openclaw-tar] Source directory not found: ${sourceDir}`);
    process.exit(1);
  }

  // Remove old tar if exists
  if (fs.existsSync(outputTar)) fs.unlinkSync(outputTar);

  console.log(`[pack-openclaw-tar] Packing: ${sourceDir}`);
  console.log(`[pack-openclaw-tar] Output:  ${outputTar}`);

  const t0 = Date.now();
  const basename = path.basename(outputTar, '.tar');
  const { totalFiles, skipped } = packSingleSource(sourceDir, outputTar, basename);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const sizeMB = (fs.statSync(outputTar).size / (1024 * 1024)).toFixed(1);
  console.log(
    `[pack-openclaw-tar] Done in ${elapsed}s: ${totalFiles} files, ${skipped} skipped, ${sizeMB} MB`,
  );
}

if (require.main === module) {
  main();
}

module.exports = { packSingleSource, packMultipleSources };
