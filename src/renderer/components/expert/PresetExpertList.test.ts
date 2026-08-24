import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./PresetExpertList.tsx', import.meta.url)),
  'utf8',
);

test('installs an expert before allowing the conversation action', () => {
  expect(source).toContain('agent.source === CoworkSessionExpertSource.Package');
  expect(source).toContain("installedAgent ? 'expertGoToConversation' : 'expertInstall'");
  expect(source).toContain('if (installedAgent) {');
  expect(source).toContain('onChatWithExpert?.(installedAgent.id);');
  expect(source).toContain('void handleInstallExpert(expert);');
});

test('does not enter a conversation after installing an expert', () => {
  const start = source.indexOf('const handleInstallExpert = useCallback');
  const end = source.indexOf('\n\n  if (experts.length === 0)', start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  expect(source.slice(start, end)).not.toContain('onChatWithExpert');
});

test('tracks concurrent expert installations independently', () => {
  expect(source).toContain('useState<Set<string>>(() => new Set())');
  expect(source).toContain('const installingExpertIdsRef = useRef(new Set<string>());');
  expect(source).toContain('installingExpertIdsRef.current.has(expert.name)');
  expect(source).toContain('installingExpertIds.has(expert.name)');
});
