#!/usr/bin/env node
// Blocks newly added files (git diff --cached --diff-filter=A) over 5000 tokens.
// Tokens are estimated dependency-free as ceil(bytes / 4).
// Exempt: Markdown (*.md, *.mdx), binaries, lockfiles, generated/vendored paths.
import { execFileSync } from "node:child_process";

const LIMIT = 5000;
const EXEMPT = [
  /\.mdx?$/i,
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|go\.sum|uv\.lock|Cargo\.lock)$/,
  /\.lock$/,
  /(^|\/)bun\.lockb?$/,
  /(^|\/)(dist|build|vendor|node_modules|generated|__snapshots__)\//,
  /\.min\.[^/]+$/,
  /\.snap$/,
];

const git = (args, opts = {}) => execFileSync("git", args, { maxBuffer: 1 << 30, ...opts });
const added = git(["diff", "--cached", "--name-only", "--diff-filter=A", "-z"])
  .toString("utf8").split("\0").filter(Boolean);

const failures = [];
for (const file of added) {
  if (EXEMPT.some((re) => re.test(file))) continue;
  const buf = git(["show", `:${file}`]);
  if (buf.subarray(0, 8000).includes(0)) continue; // binary
  const tokens = Math.ceil(buf.length / 4);
  if (tokens > LIMIT) failures.push({ file, tokens });
}

const REEXPORT = {
  ts: "TS/JS: keep the old path as a thin entry, e.g. `export * from \"./foo/types\"; export { Foo } from \"./foo/Foo\";`",
  go: "Go: split into more files in the same package (foo_types.go, foo_handlers.go, foo_helpers.go); same package means no import changes. Split big _test.go files the same way and move fixtures to testdata/.",
  py: "Python: turn foo.py into a package foo/ with __init__.py re-exporting the public names (`from .models import Foo`), or keep foo.py with `from .foo_helpers import *`.",
};
const kind = (f) => (/\.go$/.test(f) ? "go" : /\.pyi?$/.test(f) ? "py" : "ts");

if (failures.length) {
  const kinds = [...new Set(failures.map((f) => kind(f.file)))];
  console.error(
    [
      `pre-commit: BLOCKED. New files must not exceed ${LIMIT} tokens (tokens = ceil(bytes / 4)).`,
      ...failures.map((f) => `  ${f.file}: ~${f.tokens} tokens (limit ${LIMIT})`),
      "",
      "How to fix (split the file, then commit again):",
      `1. Split by responsibility into cohesive modules, each well under ${LIMIT} tokens (aim for ~2000-3000). One concern per file.`,
      "2. Move types/interfaces/constants, pure helpers, and sub-components/handlers into sibling files.",
      "3. Keep the original path as a thin entry or re-export so imports stay stable, or update every import.",
      ...kinds.map((k) => `   ${REEXPORT[k]}`),
      "4. Move fixtures and test data into separate files (fixtures/, testdata/).",
      "5. Do NOT minify, compress, or strip comments or whitespace to get under the limit, and do NOT add paths to the exclude list to bypass it.",
      "6. git add the new files and commit again.",
      "Exempt: Markdown (*.md, *.mdx), lockfiles, binaries, generated/vendored paths. See AGENTS.md (file size rule).",
    ].join("\n"),
  );
  process.exit(1);
}
