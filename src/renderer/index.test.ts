import fs from 'fs';
import path from 'path';
import { expect, test } from 'vitest';

test('switch thumbs use the primary foreground token in every theme state', () => {
  const css = fs.readFileSync(path.join(process.cwd(), 'src', 'renderer', 'index.css'), 'utf-8');

  expect(css).toMatch(
    /\[data-slot='switch-thumb'\]\s*\{\s*background-color: var\(--zy-primary-foreground\) !important;/,
  );
});
