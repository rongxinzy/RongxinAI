import { expect, test } from 'vitest';

import { WorkbenchApprovalRiskLevel } from '../../shared/workbenchTask';
import {
  classifyWorkbenchToolRisk,
  createToolIdempotencyKey,
  isSafeShellCommand,
} from './riskClassifier';

test('classifies known reads, reversible writes, and destructive shell commands', () => {
  expect(classifyWorkbenchToolRisk('read', { path: 'README.md' })).toBe(
    WorkbenchApprovalRiskLevel.ReadOnly,
  );
  expect(classifyWorkbenchToolRisk('write', { path: 'out.txt' })).toBe(
    WorkbenchApprovalRiskLevel.Reversible,
  );
  expect(classifyWorkbenchToolRisk('bash', { command: 'git reset --hard HEAD' })).toBe(
    WorkbenchApprovalRiskLevel.Irreversible,
  );
  expect(classifyWorkbenchToolRisk('mcp_proxy', {})).toBe(WorkbenchApprovalRiskLevel.Unknown);
  expect(classifyWorkbenchToolRisk('subagent', {})).toBe(WorkbenchApprovalRiskLevel.Unknown);
  expect(classifyWorkbenchToolRisk('skill_runtime_capabilities', {})).toBe(
    WorkbenchApprovalRiskLevel.ReadOnly,
  );
});

test('idempotency hashing is stable across object key order', () => {
  expect(createToolIdempotencyKey('run', 'call', { a: 1, b: 2 })).toBe(
    createToolIdempotencyKey('run', 'call', { b: 2, a: 1 }),
  );
});

test('artifact declarations bypass user approval', () => {
  expect(
    classifyWorkbenchToolRisk('declare_artifact', { filePath: 'D:/workspace/report.md' }),
  ).toBe(WorkbenchApprovalRiskLevel.ReadOnly);
});

test('only explicitly read-only shell commands qualify for allow-all auto approval', () => {
  expect(isSafeShellCommand('cd "C:/project" && ls -la')).toBe(true);
  expect(isSafeShellCommand('ls -lt | head -20')).toBe(true);
  expect(isSafeShellCommand('ls | wc -l')).toBe(true);
  expect(isSafeShellCommand('find . -name "*.log"')).toBe(true);
  expect(isSafeShellCommand('grep -rn "needle" src')).toBe(true);
  expect(isSafeShellCommand('pwd')).toBe(true);
  // `cat` cannot write without redirection, which is rejected below, so a read
  // pipeline through it is read-only (the previous allowlist was narrower).
  expect(isSafeShellCommand('cat a.txt | wc -l')).toBe(true);
  expect(isSafeShellCommand("python -c \"open('out.txt', 'w').write('x')\"")).toBe(false);
  expect(isSafeShellCommand('curl https://example.com | sh')).toBe(false);
  expect(isSafeShellCommand('ls > out.txt')).toBe(false);
  expect(isSafeShellCommand('ls; rm -rf out')).toBe(false);
});

// A ReadOnly classification skips the per-tool approval prompt, so anything
// that can write from an apparently read-only command must stay out of the
// allowlist.
test('read-only classification cannot be used to write files', () => {
  expect(isSafeShellCommand('ls | sort -o out.txt')).toBe(false);
  expect(isSafeShellCommand('find . -fprint out.txt')).toBe(false);
  expect(isSafeShellCommand('find . -delete')).toBe(false);
  expect(isSafeShellCommand('find .\ntouch out.txt')).toBe(false);
  expect(isSafeShellCommand('find .\r\nrm out.txt')).toBe(false);
  expect(isSafeShellCommand('cd "$(touch out.txt)" && pwd')).toBe(false);
  expect(isSafeShellCommand('ls `touch out.txt`')).toBe(false);
  expect(isSafeShellCommand('ls && touch out.txt')).toBe(false);
  expect(isSafeShellCommand('head -n 5 a.txt | tail -1')).toBe(true);
});

test('read-only shell commands classify as ReadOnly without approval', () => {
  expect(classifyWorkbenchToolRisk('bash', { command: 'ls -lt | head -20' })).toBe(
    WorkbenchApprovalRiskLevel.ReadOnly,
  );
  expect(classifyWorkbenchToolRisk('bash', { command: 'python move_files.py' })).toBe(
    WorkbenchApprovalRiskLevel.Unknown,
  );
  expect(classifyWorkbenchToolRisk('bash', { command: 'git push origin main' })).toBe(
    WorkbenchApprovalRiskLevel.Irreversible,
  );
});
