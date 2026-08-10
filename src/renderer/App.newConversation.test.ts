import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const appSource = readFileSync(fileURLToPath(new URL('./App.tsx', import.meta.url)), 'utf8');
const sidebarSource = readFileSync(
  fileURLToPath(new URL('./components/SidebarNavigationControls.tsx', import.meta.url)),
  'utf8',
);

const callbackBody = (source: string, name: string, nextName: string) => {
  const start = source.indexOf(`const ${name} = useCallback`);
  const end = source.indexOf(`const ${nextName} = useCallback`, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
};

test('resets active skills for every blank conversation entry point', () => {
  const handleNewChat = callbackBody(appSource, 'handleNewChat', 'handleTryMcp');

  expect(handleNewChat).toContain('dispatch(clearActiveSkills());');
  expect(handleNewChat).toContain('openNewConversation();');
  expect(sidebarSource).not.toContain('clearActiveSkills');
  expect(sidebarSource).not.toContain('workMode === WorkMode.Chat) dispatch');
});

test('preserves the selected skill when starting from use-this-skill', () => {
  const handleTrySkill = callbackBody(appSource, 'handleTrySkill', 'dismissToast');

  expect(handleTrySkill).toContain('dispatch(setActiveSkillIds([skillId]));');
  expect(handleTrySkill).toContain('openNewConversation();');
  expect(handleTrySkill).not.toContain('handleNewChat();');
});

test('routes specialized blank conversation entries through the reset boundary', () => {
  const handleTryMcp = callbackBody(appSource, 'handleTryMcp', 'handleCreateSkillByChat');
  const handleCreateSkillByChat = callbackBody(
    appSource,
    'handleCreateSkillByChat',
    'handleTrySkill',
  );

  expect(handleTryMcp).toContain('handleNewChat();');
  expect(handleCreateSkillByChat).toContain('handleNewChat();');
});
