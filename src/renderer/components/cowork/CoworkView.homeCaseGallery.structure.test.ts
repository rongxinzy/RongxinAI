import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./CoworkView.tsx', import.meta.url)), 'utf8');

const compact = (value: string) => value.replace(/\s+/g, '');

const barCall = '<QuickActionBar actions={quickActions} onActionSelect={handleActionSelect} />';
const panelCall = '<PromptPanel action={selectedAction}';
const barGuard = compact(
  `{!selectedAction && (
              <QuickActionBar actions={quickActions} onActionSelect={handleActionSelect} />
            )}`,
);
const panelGuard = compact(
  `{selectedAction && (
              <PromptPanel action={selectedAction} onPromptSelect={handleQuickActionPromptSelect} />
            )}`,
);
const spacer = 'min-h-[max(0px,calc(50%-15.5rem))]';
const columnWrapper =
  'mx-auto flex w-full max-w-5xl min-w-[320px] flex-col items-center gap-10 px-4';
const galleryWrapper = 'flex w-full flex-col gap-4 pb-8 animate-fade-in-up';

const countOf = (needle: string) => source.split(needle).length - 1;

/**
 * The category bar is the entry point: once a category is open the cases own the column
 * and the bar steps aside, so the gallery is not stacked under a second row of chrome.
 */
test('hides the quick action category bar while a case gallery is open', () => {
  const compactSource = compact(source);

  expect(compactSource.split(compact(barCall)).length - 1).toBe(1);
  expect(compactSource.split(compact(panelCall)).length - 1).toBe(1);

  // The bar and the gallery are mutually exclusive branches of the same column. Matching
  // the compacted source keeps this guard on the branching, not on the indentation.
  expect(compactSource.split(barGuard).length - 1).toBe(1);
  expect(compactSource.split(panelGuard).length - 1).toBe(1);
  expect(compactSource.indexOf(panelGuard)).toBeGreaterThan(compactSource.indexOf(barGuard));

  // The bare call may only exist inside the guard: an unguarded bar would keep showing.
  const barGuardIndex = compactSource.indexOf(barGuard);
  expect(compactSource.slice(0, barGuardIndex)).not.toContain(compact(barCall));
  expect(compactSource.slice(barGuardIndex + barGuard.length)).not.toContain(compact(barCall));

  // The bar used to be the else-branch of the gallery. The column keeps both branches
  // explicit, so neither can silently re-introduce the other.
  const column = compactSource.slice(
    compactSource.indexOf(compact(galleryWrapper)),
    compactSource.indexOf(panelGuard) + panelGuard.length,
  );
  expect(column).not.toContain('else');
});

/**
 * The case list is far taller than the viewport, so the brand block and the input cannot
 * be centred as one column: centring the column lets the cases drag the input up under
 * the page header. A spacer that measures the viewport holds the input on the visible
 * area's vertical middle instead, and the cases flow on below it.
 */
test('anchors the hero on a viewport spacer instead of centring the column', () => {
  const spacerIndex = source.indexOf(spacer);
  const columnIndex = source.indexOf(columnWrapper);

  expect(countOf(spacer)).toBe(1);
  expect(countOf(columnWrapper)).toBe(1);
  expect(spacerIndex).toBeGreaterThan(-1);
  expect(columnIndex).toBeGreaterThan(spacerIndex);
});

/**
 * Once the cases start scrolling the input has to stay put: it is the one control the
 * user needs while reading them. Sticky only holds while there is a box to travel
 * through, so the case list must be nested in the input's column - a page-level gallery
 * would let the input scroll away again after roughly its own height.
 */
test('pins the prompt input while the case list scrolls underneath it', () => {
  const columnIndex = source.indexOf(columnWrapper);
  const stickyIndex = source.indexOf('className="sticky');
  const galleryIndex = source.indexOf(galleryWrapper);

  expect(stickyIndex).toBeGreaterThan(columnIndex);
  expect(galleryIndex).toBeGreaterThan(stickyIndex);

  const between = source.slice(columnIndex, galleryIndex);
  const openDivs = (between.match(/<div/g) ?? []).length;
  const closeDivs = (between.match(/<\/div>/g) ?? []).length;
  expect(openDivs - closeDivs).toBeGreaterThan(0);

  const stickyClass = /<div className="(sticky[^"]*)"/.exec(source)?.[1] ?? '';
  expect(stickyClass).toContain('top-0');
  expect(stickyClass).toContain('z-10');
  expect(stickyClass).toContain('bg-background');
  expect(stickyClass).toContain('w-full');

  // The brand mark travels in the same layer: it has to stay on screen next to the
  // input rather than sliding away with the cases, so it must be nested inside it.
  const brandIndex = source.indexOf('min-h-28 flex-col items-center justify-center gap-5');
  expect(brandIndex).toBeGreaterThan(stickyIndex);
  expect(source.indexOf('max-w-3xl flex-col gap-3')).toBeGreaterThan(brandIndex);

  const stickyInner = source.slice(source.indexOf('<div className="sticky'), brandIndex);
  const openInSticky = (stickyInner.match(/<div/g) ?? []).length;
  const closedInSticky = (stickyInner.match(/<\/div>/g) ?? []).length;
  expect(openInSticky - closedInSticky).toBeGreaterThan(0);
});
