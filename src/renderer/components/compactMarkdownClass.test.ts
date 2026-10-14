import { describe, expect, test } from 'vitest';

import { compactMarkdownClass } from './compactMarkdownClass';

describe('compactMarkdownClass', () => {
  test('returns layout and color classes without !important override symbols', () => {
    const mutedClass = compactMarkdownClass('muted');
    const destructiveClass = compactMarkdownClass('destructive');

    expect(mutedClass).not.toContain('!');
    expect(destructiveClass).not.toContain('!');

    expect(mutedClass).toContain('leading-5');
    expect(mutedClass).toContain('text-muted-foreground');

    expect(destructiveClass).toContain('leading-5');
    expect(destructiveClass).toContain('text-destructive');
  });
});
