import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./CoworkSessionDetail.tsx', import.meta.url)),
  'utf8',
);
const composerSource = readFileSync(
  fileURLToPath(new URL('./sessionDetail/SessionComposerOverlay.tsx', import.meta.url)),
  'utf8',
);
const composerRecipes = readFileSync(
  fileURLToPath(new URL('../../theme/components/classic-message-surfaces.ts', import.meta.url)),
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

test('reserves conversation viewport above the absolutely positioned composer', () => {
  const inputArea = source.indexOf('{/* Input Area */}');
  const overlay = source.indexOf('<SessionComposerOverlay', inputArea);
  const promptInput = composerSource.indexOf('<CoworkPromptInput\n');
  const permission = source.indexOf('<CoworkPermissionModal');
  const askUserQuestion = source.indexOf('<AskUserQuestionCard');

  expect(source).toContain('const composerOverlayRef = useCoworkComposerInset(detailRootRef);');
  // 对话区与绝对定位输入框平级且 flex:1，用 paddingBottom 留出输入框高度，避免被遮挡
  expect(source).toContain('style={{ paddingBottom: COWORK_COMPOSER_INSET_VALUE }}');
  expect(source).not.toContain('bg-gradient-to-t from-background to-transparent');
  expect(source).not.toContain('style={{ height: `calc(${COWORK_COMPOSER_INSET_VALUE} + 1rem)` }}');
  expect(inputArea).toBeGreaterThanOrEqual(0);
  expect(overlay).toBeGreaterThan(inputArea);
  // The floating composer must live in the conversation column's coordinate
  // system (inside detailRoot, outside the scroll container and before the
  // artifact panel frame) so flex sizing — window and panel alike — reaches
  // it automatically.
  expect(source.slice(overlay)).toContain('overlayRef={composerOverlayRef}');
  expect(source.slice(overlay)).toContain('promptInputRef={promptInputRef}');
  expect(composerSource.slice(0, promptInput)).toContain('ref={overlayRef}');
  expect(composerSource.slice(0, promptInput)).toContain(
    'className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-4"',
  );
  const detailRootOpen = source.indexOf('ref={detailRootRef}');
  const detailRootClose = source.indexOf('{!isSessionSwitching && shouldRenderArtifactPanel && (');
  expect(detailRootOpen).toBeGreaterThan(0);
  expect(overlay).toBeGreaterThan(detailRootOpen);
  expect(overlay).toBeLessThan(detailRootClose);
  const scrollContainer = source.indexOf('ref={scrollContainerRef}');
  /*
  1、工具授权和提问卡片放在对话流（思考/工具执行）里，不要叠在底部输入框上
  2、能匹配到工具卡片时，拒绝/允许画在卡片内部，不再单独出一张授权卡
  */
  expect(askUserQuestion).toBeGreaterThan(scrollContainer);
  expect(askUserQuestion).toBeLessThan(inputArea);
  expect(permission).toBeGreaterThan(scrollContainer);
  expect(permission).toBeLessThan(inputArea);
  expect(source.indexOf('<CoworkPermissionModal', overlay)).toBe(-1);
  expect(composerSource).not.toContain('<CoworkPermissionModal');
  expect(composerSource.slice(0, promptInput)).toContain(
    'className="theme-composer-backdrop pointer-events-auto relative min-w-0"',
  );
  expect(composerRecipes).toContain("'composer-backdrop': recipe({");
  expect(composerRecipes).toContain("'background-color': 'var(--background)'");
  expect(composerRecipes).toContain("'border-top-left-radius': 'var(--zy-style-radius-3xl)'");
  expect(composerRecipes).toContain("'border-top-right-radius': 'var(--zy-style-radius-3xl)'");
  expect(composerSource).toContain('ref={promptInputRef}');
  expect(turnBlockSource).toContain('className="mx-auto w-full max-w-6xl min-w-[320px] pl-4"');
  expect(turnBlockSource).toContain('className="flex min-w-0 flex-col gap-3 py-3"');
  expect(userBubbleSource).toContain(
    'className="mx-auto flex w-full max-w-6xl min-w-[320px] flex-col items-end pl-4"',
  );
  // 验收卡改由末轮 TurnBlock.beforeCopySlot 注入，不再挂在对话流底部
  expect(source).toContain('beforeCopySlot={');
  expect(source).toContain('<WorkbenchTaskAcceptanceCard sessionId={sessionId} />');
  expect(source).not.toMatch(
    /\{sessionId && \(\s*<div className="px-3 pt-3">\s*<WorkbenchTaskAcceptanceCard/,
  );
  expect(source).toMatch(/<ConversationContent\r?\n\s+className="pt-3"/);
  expect(promptInput).toBeGreaterThan(composerSource.indexOf('ref={overlayRef}'));
});
