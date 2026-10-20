#!/usr/bin/env node
// Blocks newly added files (git diff --cached --diff-filter=A) over 5000 tokens.
// Tokens are estimated dependency-free as ceil(characters / 4).
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
  const tokens = Math.ceil([...buf.toString("utf8")].length / 4);
  if (tokens > LIMIT) failures.push(`  ${file}: ~${tokens} tokens`);
}

if (failures.length) {
  console.error(
    `pre-commit: new files must not exceed ${LIMIT} tokens (estimated as ceil(characters / 4)).\n` +
      `${failures.join("\n")}\n` +
      "Split them into smaller files. Markdown, lockfiles, binaries and generated/vendored paths are exempt; see AGENTS.md.",
  );
  process.exit(1);
}
