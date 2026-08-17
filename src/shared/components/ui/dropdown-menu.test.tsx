import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/shared/components/ui/dropdown-menu.tsx'),
  'utf8',
);
const tailwindSource = readFileSync(resolve(process.cwd(), 'src/renderer/index.css'), 'utf8');

describe('DropdownMenuContent', () => {
  test('does not force popup width to the runtime anchor width', () => {
    expect(source).not.toContain('w-(--anchor-width)');
  });

  test('includes cowork components in Tailwind source detection', () => {
    expect(tailwindSource).toContain('@source "./components/cowork";');
  });
});
