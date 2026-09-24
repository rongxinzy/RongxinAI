import { expect, test } from 'vitest';

import { CoworkSessionExpertSource } from '../../../shared/cowork/sessionExperts';
import { resolveInitialSelectedExpertIds } from './resolveInitialSelectedExpertIds';

test('uses session experts when the session already has them', () => {
  expect(
    resolveInitialSelectedExpertIds({
      sessionId: 's1',
      persistedExpertIds: ['expert-from-session'],
      currentAgentId: 'cad-agent',
      currentAgentSource: CoworkSessionExpertSource.Package,
    }),
  ).toEqual(['expert-from-session']);
});

test('selects the current expert agent on a new conversation home', () => {
  // 从专家页进入新会话：当前 agent 即专家时，输入框底部应选中（#100）
  expect(
    resolveInitialSelectedExpertIds({
      sessionId: undefined,
      persistedExpertIds: [],
      currentAgentId: 'cad-agent',
      currentAgentSource: CoworkSessionExpertSource.Package,
    }),
  ).toEqual(['cad-agent']);
});

test('does not invent an expert selection for the default main agent', () => {
  expect(
    resolveInitialSelectedExpertIds({
      sessionId: undefined,
      persistedExpertIds: [],
      currentAgentId: 'main',
      currentAgentSource: undefined,
    }),
  ).toEqual([]);
});
