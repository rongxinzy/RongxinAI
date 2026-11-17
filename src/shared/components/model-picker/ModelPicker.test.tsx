// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { ModelPicker, type ModelPickerItem, type ModelPickerLabels } from './ModelPicker';

const labels: ModelPickerLabels = {
  searchPlaceholder: 'Search models',
  emptyModels: 'No models available',
  noMatches: 'No matches',
  selectPlaceholder: 'Select model',
  currentModelLabel: 'Current model',
  recentGroup: 'Recent',
  groupsGroup: 'Routing groups',
  localGroup: 'Local models',
  otherGroup: 'All models',
  followDefault: 'Follow default',
  manageAction: 'Manage models',
  visionLabel: 'Vision',
  reasoningLabel: 'Reasoning',
  webSearchLabel: 'Web',
  toolsLabel: 'Tools',
};

const items: ModelPickerItem[] = [
  {
    id: 'deepseek-chat',
    name: 'DeepSeek Chat',
    providerLabel: 'DeepSeek',
    providerKey: 'deepseek',
    reasoning: true,
    tools: true,
    contextLabel: '128K',
  },
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    providerLabel: 'OpenAI',
    providerKey: 'openai',
    vision: true,
  },
  {
    id: 'qwen-local',
    name: 'Qwen 3 8B',
    providerLabel: 'Local',
    isLocal: true,
    vision: true,
  },
  {
    id: 'auto-smart',
    name: 'Smart Group',
    isGroup: true,
  },
];

describe('ModelPicker', () => {
  test('renders sections, capability icons, sublabel during search, and manage action', () => {
    Element.prototype.scrollIntoView = vi.fn();
    const onSelect = vi.fn();
    const onManageModels = vi.fn();

    render(
      <ModelPicker
        items={items}
        selectedId="deepseek-chat"
        recentIds={['deepseek-chat']}
        labels={labels}
        onSelect={onSelect}
        onManageModels={onManageModels}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'DeepSeek Chat' });
    fireEvent.click(trigger);

    expect(screen.getByText('Recent')).toBeInTheDocument();
    expect(screen.getByText('Routing groups')).toBeInTheDocument();
    expect(screen.getByText('Local models')).toBeInTheDocument();
    expect(screen.getByText('OpenAI')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Reasoning').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Manage models' }));
    expect(onManageModels).toHaveBeenCalledOnce();

    fireEvent.click(trigger);
    fireEvent.change(screen.getByPlaceholderText('Search models'), {
      target: { value: 'Qwen' },
    });
    const option = screen.getByRole('option', { name: /Qwen 3 8B/ });
    expect(option).toHaveTextContent('Local');
    fireEvent.click(option);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'qwen-local' }));
  });
});
