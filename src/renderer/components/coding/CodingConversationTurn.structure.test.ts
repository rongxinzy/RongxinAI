import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const turnSource = readFileSync(
  fileURLToPath(new URL('./CodingConversationTurn.tsx', import.meta.url)),
  'utf8',
);
const activitySource = readFileSync(
  fileURLToPath(new URL('./CodingActivityView.tsx', import.meta.url)),
  'utf8',
);

test('keeps permission tool cards collapsed until explicitly opened', () => {
  expect(turnSource).toContain('open={expandedActivityIds.has(activity.id)}');
  expect(turnSource).not.toContain('activity.kind === CodingConversationActivityKind.Permission ||');
  expect(activitySource).toContain('defaultOpen={false}');
  expect(activitySource).not.toContain(
    'defaultOpen={activity.kind === CodingConversationActivityKind.Permission}',
  );
});

test('shows completed duration when a turn has no reasoning or tool segments', () => {
  expect(turnSource).toContain('{!hasReasoningGroup && turn.completedAt !== null ? (');
  expect(turnSource).toContain('const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));');
  expect(turnSource).toContain('const seconds = totalSeconds % 60;');
  expect(turnSource).toContain('const minutes = totalMinutes % 60;');
});

test('does not mount the approval card inside the process group', () => {
  expect(activitySource).not.toContain('CodingPermissionCard');
  expect(turnSource).not.toContain('pendingPermissionId');
});
