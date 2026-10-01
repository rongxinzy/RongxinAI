import { cn } from '@shared/lib/utils';

/**
 * Compact markdown tone for dense surfaces (activity feed, failure detail).
 * Layout is shared; only the semantic text color differs. Class names are static
 * so Tailwind can see every utility.
 */
const COMPACT_MARKDOWN_LAYOUT = cn(
  '!leading-5',
  '[&_p]:!my-0 [&_p]:!leading-5',
  '[&_li]:!my-0 [&_li]:!leading-5',
  '[&_ul]:!my-0 [&_ol]:!my-0',
  '[&_h1]:!my-0 [&_h1]:!text-sm [&_h1]:!font-semibold [&_h1]:!leading-5',
  '[&_h2]:!my-0 [&_h2]:!text-sm [&_h2]:!font-semibold [&_h2]:!leading-5',
  '[&_h3]:!my-0 [&_h3]:!text-sm [&_h3]:!font-semibold [&_h3]:!leading-5',
  '[&_blockquote]:!my-0',
);

const COMPACT_MARKDOWN_MUTED = cn(
  COMPACT_MARKDOWN_LAYOUT,
  'text-muted-foreground',
  '[&_p]:!text-muted-foreground [&_strong]:!text-muted-foreground',
  '[&_li]:!text-muted-foreground [&_ul]:!text-muted-foreground [&_ol]:!text-muted-foreground',
  '[&_h1]:!text-muted-foreground [&_h2]:!text-muted-foreground [&_h3]:!text-muted-foreground',
  '[&_blockquote]:!text-muted-foreground [&_code]:!text-muted-foreground',
);

const COMPACT_MARKDOWN_DESTRUCTIVE = cn(
  COMPACT_MARKDOWN_LAYOUT,
  'text-destructive',
  '[&_p]:!text-destructive [&_strong]:!text-destructive',
  '[&_li]:!text-destructive [&_ul]:!text-destructive [&_ol]:!text-destructive',
  '[&_h1]:!text-destructive [&_h2]:!text-destructive [&_h3]:!text-destructive',
  '[&_blockquote]:!text-destructive [&_code]:!text-destructive',
);

export type CompactMarkdownTone = 'muted' | 'destructive';

export const compactMarkdownClass = (tone: CompactMarkdownTone): string =>
  tone === 'destructive' ? COMPACT_MARKDOWN_DESTRUCTIVE : COMPACT_MARKDOWN_MUTED;
