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

test('reserves conversation viewport above the absolutely positioned composer', () => {
  const inputArea = source.indexOf('{/* Input Area */}');
  const overlay = source.indexOf('ref={composerOverlayRef}', inputArea);
  const promptInput = source.indexOf('<CoworkPromptInput', inputArea);
  const permission = source.indexOf('<CoworkPermissionModal');
  const askUserQuestion = source.indexOf('<AskUserQuestionCard');

  expect(source).toContain('const composerOverlayRef = useCoworkComposerInset(detailRootRef);');
  // 对话区与绝对定位输入框平级且 flex:1，用 paddingBottom 留出输入框高度，避免被遮挡
  expect(source).toContain('style={{ paddingBottom: COWORK_COMPOSER_INSET_VALUE }}');
  expect(source).toContain(
    'className="pointer-events-none absolute inset-x-0 z-[1] h-16 bg-gradient-to-t from-background to-transparent"',
  );
  expect(source).toContain('style={{ bottom: COWORK_COMPOSER_INSET_VALUE }}');
  expect(source).not.toContain(
    'style={{ height: `calc(${COWORK_COMPOSER_INSET_VALUE} + 1rem)` }}',
  );
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
  /*
  2026/09/16 lixiang  
  1、工具授权和提问卡片放在对话流（思考/工具执行）里，不要叠在底部输入框上
  2、能匹配到工具卡片时，拒绝/允许画在卡片内部，不再单独出一张授权卡
  */ 
  expect(askUserQuestion).toBeGreaterThan(scrollContainer);
  expect(askUserQuestion).toBeLessThan(inputArea);
  expect(permission).toBeGreaterThan(scrollContainer);
  expect(permission).toBeLessThan(inputArea);
  expect(source.indexOf('<CoworkPermissionModal', promptInput)).toBe(-1);
  expect(source.slice(overlay, promptInput)).toContain(
    'className="pointer-events-auto relative min-w-0 rounded-t-3xl bg-background pb-4"',
  );
  expect(turnBlockSource).toContain('className="mx-auto w-full max-w-6xl min-w-[320px] pl-4"');
  expect(turnBlockSource).toContain('className="flex min-w-0 flex-1 flex-col gap-3 py-3"');
  expect(userBubbleSource).toContain(
    'className="mx-auto flex w-full max-w-6xl min-w-[320px] flex-col items-end pl-4"',
  );
  // 2026/09/20 lixiang  验收卡改由末轮 TurnBlock.beforeCopySlot 注入，不再挂在对话流底部
  expect(source).toContain('beforeCopySlot={');
  expect(source).toContain('<WorkbenchTaskAcceptanceCard sessionId={sessionId} />');
  expect(source).not.toMatch(
    /\{sessionId && \(\s*<div className="px-3 pt-3">\s*<WorkbenchTaskAcceptanceCard/,
  );
  expect(source).toMatch(/<ConversationContent\r?\n\s+className="pt-3"/);
  expect(promptInput).toBeGreaterThan(overlay);
});
