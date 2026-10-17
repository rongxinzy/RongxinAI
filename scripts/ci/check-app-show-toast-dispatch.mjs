#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseSync } from 'oxc-parser';

const ROOT = path.resolve(import.meta.dirname, '../..');
const ALLOWED = new Set([path.join(ROOT, 'src/renderer/services/toastNotification.ts')]);

const SOURCE_PATTERN = /\.(ts|tsx)$/;

function trackedRendererSources() {
  const output = execFileSync('git', ['ls-files', 'src/renderer'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return output
    .split('\n')
    .map(line => line.trim())
    .filter(
      line =>
        SOURCE_PATTERN.test(line) && !line.endsWith('.test.ts') && !line.endsWith('.test.tsx'),
    );
}

function isAppShowToastLiteral(node) {
  if (!node) return false;
  if (node.type === 'Literal' && node.value === 'app:showToast') return true;
  if (node.type === 'StringLiteral' && node.value === 'app:showToast') return true;
  return false;
}

function isForbiddenDispatch(node) {
  if (node.type !== 'CallExpression') return false;
  const callee = node.callee;
  if (callee?.type !== 'MemberExpression' || callee.property?.name !== 'dispatchEvent') {
    return false;
  }
  for (const arg of node.arguments ?? []) {
    if (arg.type !== 'NewExpression' || arg.callee?.name !== 'CustomEvent') continue;
    const [firstArg] = arg.arguments ?? [];
    if (isAppShowToastLiteral(firstArg)) return true;
  }
  return false;
}

function walk(node, onMatch) {
  if (!node || typeof node !== 'object') return;
  if (isForbiddenDispatch(node)) onMatch(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) walk(child, onMatch);
    } else if (value && typeof value === 'object') {
      walk(value, onMatch);
    }
  }
}

const violations = [];
for (const relative of trackedRendererSources()) {
  const absolute = path.join(ROOT, relative);
  if (ALLOWED.has(absolute)) continue;
  const text = fs.readFileSync(absolute, 'utf8');
  const { program } = parseSync(relative, text, { sourceType: 'module' });
  walk(program, node => {
    const start = node.start ?? 0;
    const line = text.slice(0, start).split('\n').length;
    violations.push(`${relative}:${line}`);
  });
}

if (violations.length > 0) {
  console.error(
    'Direct app:showToast CustomEvent dispatches are forbidden. Use showAppToast from toastNotification.ts instead:\n',
  );
  for (const violation of violations) console.error(`  ${violation}`);
  process.exit(1);
}

console.log('check-app-show-toast-dispatch: ok');
