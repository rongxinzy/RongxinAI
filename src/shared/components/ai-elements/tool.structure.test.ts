import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./tool.tsx', import.meta.url)), 'utf8');

test('keeps tool header icon and title slots stable', () => {
  expect(source).toContain('flex size-4 shrink-0 items-center justify-center');
  expect(source).toContain('min-w-0 truncate font-medium text-sm');
});

test('supports placing tool execution status in the trailing header group', () => {
  expect(source).toContain('statusAtEnd?: boolean');
  expect(source).toContain('ml-auto flex shrink-0 items-center gap-2');
  expect(source).toContain('{statusAtEnd && statusBadge}');
});

test('rotates the tool collapse icon from the Base UI trigger state', () => {
  expect(source).toContain('group/trigger');
  expect(source).toContain('rotate-0 text-muted-foreground transition-transform');
  expect(source).toContain('group-data-[panel-open]/trigger:rotate-180');
});
