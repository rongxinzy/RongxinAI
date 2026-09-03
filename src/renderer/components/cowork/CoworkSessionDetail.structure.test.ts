import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./CoworkSessionDetail.tsx', import.meta.url)),
  'utf8',
);
const turnBlockSource = readFileSync(
  fileURLToPath(new URL('./components/TurnBlock.tsx', import.meta.url)),
  'utf8',
);
const userBubbleSource = readFileSync(
  fileURLToPath(new URL('./components/UserBubble.tsx', import.meta.url)),
  'utf8',
);

test('lets the conversation fill the pane behind the floating composer', () => {
  const inputArea = source.indexOf('{/* Input Area */}');
  const overlay = source.indexOf('ref={composerOverlayRef}', inputArea);
  const promptInput = source.indexOf('<CoworkPromptInput', inputArea);
  const permission = source.indexOf('<CoworkPermissionModal', promptInput);

  expect(source).toContain('const composerOverlayRef = useCoworkComposerInset(detailRootRef);');
  expect(source).toContain('style={{ height: `calc(${COWORK_COMPOSER_INSET_VALUE} + 1rem)` }}');
  expect(source).toContain('style={{ bottom: `calc(${COWORK_COMPOSER_INSET_VALUE} + 1rem)` }}');
  expect(inputArea).toBeGreaterThanOrEqual(0);
  expect(overlay).toBeGreaterThan(inputArea);
  // The floating composer must live in the conversation column's coordinate
  // system (inside detailRoot, outside the scroll container and before the
  // artifact panel frame) so flex sizing — window and panel alike — reaches
  // it automatically.
  expect(source.slice(overlay, promptInput)).toContain(
    'className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-4"',
  );
  const detailRootOpen = source.indexOf('ref={detailRootRef}');
  const detailRootClose = source.indexOf('{!isSessionSwitching && shouldRenderArtifactPanel && (');
  expect(detailRootOpen).toBeGreaterThan(0);
  expect(overlay).toBeGreaterThan(detailRootOpen);
  expect(overlay).toBeLessThan(detailRootClose);
  const scrollContainer = source.indexOf('ref={scrollContainerRef}');
  const overlayClose = source.indexOf('{!isSessionSwitching && inlinePermission', overlay);
  expect(overlayClose).toBeGreaterThan(scrollContainer);
  expect(source.slice(overlay, promptInput)).toContain(
    'className="pointer-events-auto relative col-start-1 row-start-1 min-w-0 self-end rounded-t-3xl bg-background pb-4"',
  );
  expect(turnBlockSource).toContain('className="mx-auto w-full max-w-5xl min-w-[320px] pl-4"');
  expect(turnBlockSource).toContain('className="flex min-w-0 flex-1 flex-col gap-3 py-3"');
  expect(userBubbleSource).toContain(
    'className="mx-auto flex w-full max-w-5xl min-w-[320px] flex-col items-end pl-4"',
  );
  expect(source).toMatch(/<ConversationContent\r?\n\s+className="pt-3"/);
  expect(promptInput).toBeGreaterThan(overlay);
  expect(permission).toBeGreaterThan(promptInput);
});
