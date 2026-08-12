import { describe, expect, test } from 'vitest';

import {
  buildChatAgentSystemPrompt,
  ChatExecution,
  resolveChatExecution,
} from './chatExecutionRouter';

describe('resolveChatExecution', () => {
  test('returns direct when no skills and no session', () => {
    expect(resolveChatExecution({ activeSkillIds: [] })).toBe(ChatExecution.Direct);
  });

  test('returns agent when submission has skills', () => {
    expect(resolveChatExecution({ activeSkillIds: ['docx'] })).toBe(ChatExecution.Agent);
  });

  test('returns agent when session has persisted skill ids but submission has none', () => {
    expect(
      resolveChatExecution({
        activeSkillIds: [],
        session: { activeSkillIds: ['docx'] },
      }),
    ).toBe(ChatExecution.Agent);
  });

  test('returns direct when neither submission nor session has skills', () => {
    expect(
      resolveChatExecution({
        activeSkillIds: [],
        session: { activeSkillIds: [] },
      }),
    ).toBe(ChatExecution.Direct);
  });

  test('returns direct when session has no activeSkillIds field', () => {
    expect(resolveChatExecution({ activeSkillIds: [], session: {} })).toBe(ChatExecution.Direct);
  });

  test('returns direct when session is null', () => {
    expect(resolveChatExecution({ activeSkillIds: [], session: null })).toBe(ChatExecution.Direct);
  });
});

describe('buildChatAgentSystemPrompt', () => {
  test('joins skill prompt and base prompt with a blank line', () => {
    expect(buildChatAgentSystemPrompt('skill prompt', 'base prompt')).toBe(
      'skill prompt\n\nbase prompt',
    );
  });

  test('returns skill prompt alone when base is missing', () => {
    expect(buildChatAgentSystemPrompt('skill prompt', undefined)).toBe('skill prompt');
  });

  test('returns base prompt alone when skill prompt is missing', () => {
    expect(buildChatAgentSystemPrompt(undefined, 'base prompt')).toBe('base prompt');
  });

  test('returns undefined when both parts are missing', () => {
    expect(buildChatAgentSystemPrompt(undefined, undefined)).toBeUndefined();
  });

  test('ignores whitespace-only parts', () => {
    expect(buildChatAgentSystemPrompt('   ', 'base prompt')).toBe('base prompt');
    expect(buildChatAgentSystemPrompt('   ', '')).toBeUndefined();
  });
});
