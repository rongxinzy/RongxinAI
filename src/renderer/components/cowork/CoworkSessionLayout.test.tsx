// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useState } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

import { i18nService } from '../../services/i18n';
import { CoworkSessionLayout } from './CoworkSessionLayout';

const taskAuditSource = readFileSync(
  resolve('src/renderer/components/cowork/workbenchTaskAudit/WorkbenchTaskAuditView.tsx'),
  'utf8',
);

vi.mock('../icons/ArtifactPanelAnimatedToggleIcon', () => ({
  ArtifactPanelAnimatedToggleIcon: () => <span data-testid="artifact-toggle-icon" />,
}));

vi.mock('../icons/SidebarAnimatedMessageCirclePlusIcon', () => ({
  SidebarAnimatedMessageCirclePlusIcon: () => <span data-testid="new-chat-icon" />,
}));

vi.mock('../window/WindowTitleBar', () => ({
  default: () => <div data-testid="window-title-bar" />,
}));

vi.mock('./WorkbenchTaskTrajectory', () => ({
  WorkbenchTaskTrajectory: () => <div>{i18nService.t('coworkTraceTab')}</div>,
}));

function StatefulConversation() {
  const [value, setValue] = useState('');

  return (
    <input
      aria-label="conversation draft"
      value={value}
      onChange={event => setValue(event.target.value)}
    />
  );
}

beforeEach(() => {
  i18nService.setLanguage('zh', { persist: false });
  // PageHeader reads the platform for macOS traffic-light padding.
  (window as unknown as { electron: unknown }).electron = { platform: 'darwin' };
});

test('renders the title above tabs and preserves conversation state across tab switches', async () => {
  const user = userEvent.setup();

  render(
    <CoworkSessionLayout
      title="布局调整会话"
      sessionId="session-1"
      isSessionSwitching={false}
      isArtifactPanelOpen={false}
      onToggleArtifactPanel={vi.fn()}
    >
      <StatefulConversation />
    </CoworkSessionLayout>,
  );

  expect(screen.getByRole('heading', { name: '布局调整会话' })).toBeTruthy();
  const conversationTab = screen.getByRole('tab', {
    name: i18nService.t('coworkConversationTab'),
  });
  const traceTab = screen.getByRole('tab', { name: i18nService.t('coworkTraceTab') });
  expect(conversationTab.getAttribute('aria-selected')).toBe('true');
  expect(
    screen.getByRole('tabpanel', { name: i18nService.t('coworkConversationTab') }),
  ).toHaveClass('flex', 'flex-col');

  const draft = screen.getByRole('textbox', { name: 'conversation draft' });
  await user.type(draft, '保留草稿');
  await user.click(traceTab);

  expect(traceTab.getAttribute('aria-selected')).toBe('true');
  expect(draft).toBeTruthy();

  await user.click(conversationTab);
  expect(screen.getByRole('textbox', { name: 'conversation draft' })).toHaveValue('保留草稿');
});

test('renders the task audit as a single-column timeline view', () => {
  expect(taskAuditSource).not.toContain('md:grid-cols-2');
  expect(taskAuditSource).not.toContain('<WorkbenchTaskAuditSection');
  expect(taskAuditSource).toContain('max-w-3xl');
  expect(taskAuditSource).toContain('WorkbenchTimeline');
});
