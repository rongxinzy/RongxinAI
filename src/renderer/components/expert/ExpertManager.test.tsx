// @vitest-environment jsdom
import { AgentId, DefaultAgentProfile } from '@shared/agent';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { RootState } from '../../store';
import type { Agent } from '../../types/agent';

const fixture = vi.hoisted(() => ({
  agents: [] as Agent[],
}));

vi.mock('react-redux', () => ({
  useSelector: (selector: (state: RootState) => unknown) =>
    selector({
      agent: { agents: fixture.agents, currentAgentId: AgentId.Main },
    } as unknown as RootState),
}));

vi.mock('../../services/agent', () => ({
  agentService: {
    getPresetExperts: vi.fn(async () => []),
    loadAgents: vi.fn(async () => fixture.agents),
    deleteAgent: vi.fn(async () => true),
  },
}));

vi.mock('./CreateExpertDialog', () => ({
  CreateExpertDialog: () => null,
}));

vi.mock('./ExpertDetailDialog', () => ({
  ExpertDetailDialog: () => null,
}));

import ExpertManager from './ExpertManager';

const makeAgent = (overrides: Partial<Agent>): Agent => ({
  id: 'custom-1',
  name: 'Custom Expert',
  description: 'Helpful specialist',
  systemPrompt: '',
  identity: '',
  model: '',
  workingDirectory: '',
  icon: '',
  skillIds: [],
  enabled: true,
  pinned: false,
  isDefault: false,
  source: 'custom',
  presetId: '',
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

beforeEach(() => {
  fixture.agents = [];
});

describe('ExpertManager', () => {
  test('hides the built-in default main agent from custom experts while showing user-created experts', async () => {
    fixture.agents = [
      makeAgent({
        id: AgentId.Main,
        name: DefaultAgentProfile.Name,
        isDefault: true,
        source: 'custom',
      }),
      makeAgent({
        id: 'agent-custom-1',
        name: 'Research Helper',
        isDefault: false,
        source: 'custom',
      }),
    ];

    render(<ExpertManager />);

    await waitFor(() => {
      expect(screen.getByText('Research Helper')).toBeTruthy();
    });
    expect(screen.queryByText(DefaultAgentProfile.Name)).toBeNull();
    expect(screen.getByRole('tab', { name: /\(1\)/ })).toBeTruthy();
  });
});
