/**
 * SSR contract tests for the active skill badge.
 *
 * The repo's Vitest config runs in the `node` environment without jsdom or
 * @testing-library and only includes `*.test.ts` (no JSX), so these tests
 * render via React.createElement + react-dom/server's renderToStaticMarkup.
 * Effects never run during SSR, which conveniently sidesteps browser-only
 * APIs (ResizeObserver, window, etc.).
 *
 * Skill selections are input tokens: neutral pills with semantic shortcut
 * labels, individually removable and without a separate bulk-clear action.
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import type { Store } from 'redux';
import { expect, test, vi } from 'vitest';

import type { LocalizedQuickAction } from '../../types/quickAction';
import type { Skill } from '../../types/skill';
import ActiveSkillBadge from './ActiveSkillBadge';

vi.mock('../../services/i18n', () => {
  const translations: Record<string, string> = {
    chatSkillDeepResearch: '深度调研',
    clearSkill: '移除技能',
  };
  return {
    i18nService: {
      t: (key: string) => translations[key] ?? key,
    },
  };
});

vi.mock('../../services/skillIcon', () => ({
  resolveSkillIconUrl: (iconUrl?: string) => iconUrl,
}));

interface FakeState {
  skill: {
    skills: Skill[];
    activeSkillIds: string[];
  };
  quickAction: {
    actions: LocalizedQuickAction[];
    selectedActionId: string | null;
    selectedPromptId: string | null;
    isLoading: boolean;
  };
}

const makeSkill = (overrides: Partial<Skill> & { id: string }): Skill => ({
  name: overrides.id,
  description: '',
  enabled: true,
  pinned: false,
  isOfficial: false,
  isBuiltIn: false,
  updatedAt: 0,
  prompt: '',
  skillPath: `/skills/${overrides.id}/SKILL.md`,
  ...overrides,
});

const makeQuickAction = (id: string, skillMapping: string): LocalizedQuickAction => ({
  id,
  label: id,
  icon: 'bolt',
  color: '#000000',
  skillMapping,
  prompts: [],
});

const makeState = (partial?: {
  skills?: Skill[];
  activeSkillIds?: string[];
  actions?: LocalizedQuickAction[];
  selectedActionId?: string | null;
}): FakeState => ({
  skill: {
    skills: partial?.skills ?? [],
    activeSkillIds: partial?.activeSkillIds ?? [],
  },
  quickAction: {
    actions: partial?.actions ?? [],
    selectedActionId: partial?.selectedActionId ?? null,
    selectedPromptId: null,
    isLoading: false,
  },
});

// react-redux's Provider only needs getState/dispatch/subscribe at runtime;
// a full Redux store would drag in the whole slice graph and its IPC services.
const createFakeStore = (state: FakeState): Store =>
  ({
    getState: () => state,
    dispatch: vi.fn(),
    subscribe: () => () => {},
  }) as unknown as Store;

const renderBadge = (state: FakeState): string =>
  renderToStaticMarkup(
    React.createElement(Provider, {
      store: createFakeStore(state),
      // eslint-disable-next-line react/no-children-prop -- .test.ts files cannot use JSX
      children: React.createElement(ActiveSkillBadge),
    }),
  );

const countRemoveButtons = (html: string): number => html.match(/title="移除技能"/g)?.length ?? 0;

test('renders nothing when no skill is active and no quick action is selected', () => {
  expect(renderBadge(makeState())).toBe('');
});

test('renders core skills as neutral input tokens with the semantic shortcut label', () => {
  const html = renderBadge(
    makeState({
      skills: [makeSkill({ id: 'deep-research', name: 'deep-research-raw-name' })],
      activeSkillIds: ['deep-research'],
    }),
  );

  // Name contract: the shortcut labelKey wins over the raw skill name.
  expect(html).toContain('深度调研');
  expect(html).not.toContain('deep-research-raw-name');

  // Style contract: the token belongs to the input content, not a blue toolbar badge.
  expect(html).toContain('rounded-full');
  expect(html).toContain('bg-muted');
  expect(html).toContain('text-foreground');
  expect(html).not.toContain('text-(--zy-skill-blue-foreground)');
});

test('falls back to displayName then name for non-core skills', () => {
  const html = renderBadge(
    makeState({
      skills: [
        makeSkill({ id: 'custom-a', name: 'raw-name-a', displayName: '我的技能' }),
        makeSkill({ id: 'custom-b', name: 'Plain Name' }),
      ],
      activeSkillIds: ['custom-a', 'custom-b'],
    }),
  );

  expect(html).toContain('我的技能');
  expect(html).toContain('Plain Name');
  expect(html).not.toContain('raw-name-a');
});

test('renders a remove button titled with the clearSkill label for every chip', () => {
  const html = renderBadge(
    makeState({
      skills: [
        makeSkill({ id: 'deep-research' }),
        makeSkill({ id: 'custom-b', name: 'Plain Name' }),
      ],
      activeSkillIds: ['deep-research', 'custom-b'],
    }),
  );

  expect(countRemoveButtons(html)).toBe(2);
  expect(html).not.toContain('全部清除');
});

test('renders the quick action skill chip when only a quick action is selected', () => {
  const html = renderBadge(
    makeState({
      skills: [makeSkill({ id: 'deep-research' })],
      activeSkillIds: [],
      actions: [makeQuickAction('qa-deep', 'deep-research')],
      selectedActionId: 'qa-deep',
    }),
  );

  expect(html).toContain('深度调研');
  expect(countRemoveButtons(html)).toBe(1);
});

test('hides the quick action fallback chip while real skills are active', () => {
  const html = renderBadge(
    makeState({
      skills: [
        makeSkill({ id: 'custom-b', name: 'Plain Name' }),
        makeSkill({ id: 'deep-research' }),
      ],
      activeSkillIds: ['custom-b'],
      actions: [makeQuickAction('qa-deep', 'deep-research')],
      selectedActionId: 'qa-deep',
    }),
  );

  expect(html).toContain('Plain Name');
  expect(html).not.toContain('深度调研');
  expect(countRemoveButtons(html)).toBe(1);
});
