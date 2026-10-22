#!/usr/bin/env node
/**
 * Publish the DOCX Skill's .NET CLI as a self-contained, trimmed runtime and keep
 * it inside the Skill directory so it rides in the existing `skills` component.
 *
 * The Skill previously required `dotnet` on the user's machine (`dotnet run`),
 * which a clean Windows install never has — DOCX silently degraded to the
 * limited Markdown fallback. Publishing self-contained removes that dependency.
 *
 * Needs the .NET SDK at *build* time only. CI installs it with setup-dotnet and
 * runs this with --required; a local build without the SDK warns and keeps the
 * previous `dotnet run` fallback instead of failing the whole packaging run.
 */

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SKILL_ROOT = path.join(PROJECT_ROOT, 'SKILLs', 'docx');
const CSPROJ = path.join(
  SKILL_ROOT,
  'scripts',
  'dotnet',
  'MiniMaxAIDocx.Cli',
  'MiniMaxAIDocx.Cli.csproj',
);
const OUTPUT_DIR = path.join(SKILL_ROOT, 'runtime');
// The CLI project keeps its own assembly name; renaming it collides with the
// MiniMaxAIDocx.Core assembly ("Ambiguous project name").
const EXECUTABLE_NAME = 'MiniMaxAIDocx.Cli.exe';
const EXECUTABLE = path.join(OUTPUT_DIR, EXECUTABLE_NAME);
const BUILD_INFO = path.join(OUTPUT_DIR, 'build-info.json');

function findDotnet() {
  const probe = spawnSync('dotnet', ['--version'], { encoding: 'utf8', windowsHide: true });
  if (probe.error || probe.status !== 0) return null;
  return String(probe.stdout || '').trim() || null;
}

function latestSourceMtime(dir) {
  let newest = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'bin' || entry.name === 'obj') continue;
        stack.push(full);
      } else if (entry.isFile() && (entry.name.endsWith('.cs') || entry.name.endsWith('.csproj'))) {
        newest = Math.max(newest, fs.statSync(full).mtimeMs);
      }
    }
  }
  return newest;
}

function isUpToDate() {
  if (!fs.existsSync(EXECUTABLE) || !fs.existsSync(BUILD_INFO)) return false;
  try {
    const info = JSON.parse(fs.readFileSync(BUILD_INFO, 'utf8'));
    // Trimming must stay off: System.Text.Json reflection is disabled by the
    // trimmer, which breaks `--json`, `analyze`, `diff` and `fill-placeholders`.
    if (info.trimmed !== false) return false;
    if (info.assemblyName !== EXECUTABLE_NAME) return false;
  } catch {
    return false;
  }
  return (
    fs.statSync(EXECUTABLE).mtimeMs > latestSourceMtime(path.join(SKILL_ROOT, 'scripts', 'dotnet'))
  );
}

function main() {
  const required = process.argv.includes('--required') || process.env.CI === 'true';
  const force = process.argv.includes('--force');

  if (!force && isUpToDate()) {
    console.log('[docx-runtime] self-contained CLI is up to date');
    return;
  }

  const dotnetVersion = findDotnet();
  if (!dotnetVersion) {
    const message =
      '[docx-runtime] .NET SDK not found; skipping the self-contained DOCX CLI. ' +
      'The Skill will fall back to `dotnet run` and degrade to the Markdown writer.';
    if (required) {
      console.error(message.replace('skipping', 'failing the build because it is required'));
      process.exit(1);
    }
    console.warn(message);
    return;
  }

  fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const args = [
    'publish',
    CSPROJ,
    '-c',
    'Release',
    '-r',
    'win-x64',
    '--self-contained',
    'true',
    // Trimming is intentionally off. With PublishTrimmed the SDK disables
    // System.Text.Json reflection, and `analyze --json`, `diff` and
    // `edit fill-placeholders` then throw "Reflection-based serialization has
    // been disabled" at runtime (verified 2026-10-22 on the trimmed build).
    '-p:PublishTrimmed=false',
    '-p:DebugType=none',
    '-p:DebugSymbols=false',
    '-o',
    OUTPUT_DIR,
  ];
  console.log(`[docx-runtime] dotnet ${dotnetVersion} publish (self-contained, no trimming)`);
  const result = spawnSync('dotnet', args, {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
    windowsHide: true,
    env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1' },
  });
  if (result.status !== 0) {
    console.error(`[docx-runtime] dotnet publish failed with exit code ${result.status}`);
    process.exit(1);
  }
  if (!fs.existsSync(EXECUTABLE)) {
    console.error(`[docx-runtime] publish did not produce ${EXECUTABLE}`);
    process.exit(1);
  }

  let bytes = 0;
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) bytes += fs.statSync(full).size;
    }
  };
  walk(OUTPUT_DIR);

  fs.writeFileSync(
    BUILD_INFO,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        runtimeIdentifier: 'win-x64',
        selfContained: true,
        trimmed: false,
        assemblyName: EXECUTABLE_NAME,
        dotnetVersion,
        builtAt: new Date().toISOString(),
        bytes,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  console.log(`[docx-runtime] published ${(bytes / 1048576).toFixed(1)} MB to ${OUTPUT_DIR}`);

  // Intermediate artifacts live inside the Skill tree and would otherwise be
  // shipped in the `skills` component (measured 94 MB of bin/obj).
  removeDotnetBuildArtifacts(path.join(SKILL_ROOT, 'scripts', 'dotnet'));
}

function removeDotnetBuildArtifacts(dir) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = path.join(dir, entry.name);
    if (entry.name === 'bin' || entry.name === 'obj') {
      fs.rmSync(full, { recursive: true, force: true });
      continue;
    }
    removeDotnetBuildArtifacts(full);
  }
}

main();
