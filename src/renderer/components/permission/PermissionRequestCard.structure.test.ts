import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const read = (name: string): string =>
  readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');

const shell = read('./PermissionRequestCard.tsx');
const workCard = read('../cowork/CoworkPermissionModal.tsx');
const codingCard = read('../coding/CodingPermissionCard.tsx');

test('owns the inline permission surface, risk banner and footer slots', () => {
  expect(shell).toContain('theme-permission-inline-surface');
  expect(shell).toContain(
    '<PermissionDangerBanner level={dangerLevel} reasonText={dangerReasonText} />',
  );
  expect(shell).toContain('flex items-center justify-end gap-3 px-5 py-3');
  expect(shell).toContain('export const PermissionToolBody');
});

test('renders both permission cards through the shared shell', () => {
  expect(workCard).toContain('<PermissionRequestCard');
  expect(workCard).toContain('<PermissionToolBody');
  expect(codingCard).toContain('<PermissionRequestCard');
  expect(codingCard).toContain('<PermissionToolBody');
});

test('keeps the risk banner palette confined to the shared shell', () => {
  expect(shell).toContain('bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800');
  expect(shell).toContain(
    'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800',
  );
  expect(workCard).not.toContain('bg-red-50');
  expect(workCard).not.toContain('bg-yellow-50');
  expect(codingCard).not.toContain('bg-red-50');
});
