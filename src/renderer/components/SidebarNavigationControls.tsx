import { useSelector } from 'react-redux';

import { i18nService } from '../services/i18n';
import { workspaceService } from '../services/workspace';
import { shouldShowLocalInferenceNavigation } from '../services/managedModelUiPolicy';
import type { RootState } from '../store';
import { selectHasActiveActivityRun } from '../store/selectors/activitySelectors';
import { WorkMode } from '../store/workMode/constants';
import type { PrefetchableFeatureView } from './featureViewPrefetch';
import { SidebarNavigationView, type SidebarNavigationEntry } from './shell/SidebarNavigationView';

export type SidebarActiveView =
  | 'cowork'
  | 'skills'
  | 'scheduledTasks'
  | 'activity'
  | 'mcp'
  | 'localInference'
  | 'expert'
  | 'coding'
  | 'todo';

interface SidebarNavigationControlsProps {
  activeView: SidebarActiveView;
  onNewChat: () => void;
  onShowExpert: () => void;
  onShowCoding: () => void;
  onShowTodo: () => void;
  onShowLocalInference: () => void;
  onShowScheduledTasks: () => void;
  onShowActivity: () => void;
  onWorkModeChange: (checked: boolean) => void;
  workMode: WorkMode;
  managedModelsOnly?: boolean;
  /** Warms the lazily loaded chunk for a view on hover/focus intent. */
  onPrefetchView?: (view: PrefetchableFeatureView) => void;
}

export const SidebarNavigationControls = ({
  activeView,
  onNewChat,
  onShowExpert,
  onShowCoding,
  onShowTodo,
  onShowLocalInference,
  onShowScheduledTasks,
  onShowActivity,
  onWorkModeChange,
  workMode,
  managedModelsOnly = false,
  onPrefetchView,
}: SidebarNavigationControlsProps) => {
  const hasActiveActivityRun = useSelector((state: RootState) => selectHasActiveActivityRun(state));
  const activeSkillIds = useSelector((state: RootState) => state.skill.activeSkillIds);
  const isChat = workMode === WorkMode.Chat;
  const handleNewConversation = () => {
    if (workMode === WorkMode.Work) void workspaceService.clearWorkspaceSelection();
    onNewChat();
  };
  const entries: SidebarNavigationEntry[] = [];
  const addView = (
    id: SidebarNavigationEntry['icon'] & SidebarActiveView,
    label: string,
    onClick: () => void,
    prefetch?: PrefetchableFeatureView,
  ) => {
    entries.push({
      id,
      icon: id,
      label,
      onClick,
      active: activeView === id,
      currentPage: activeView === id,
      onIntent: prefetch ? () => onPrefetchView?.(prefetch) : undefined,
      ...(id === 'activity'
        ? { running: hasActiveActivityRun, testId: 'sidebar-view-activity' }
        : {}),
    });
  };
  if (shouldShowLocalInferenceNavigation(isChat, managedModelsOnly)) {
    addView(
      'localInference',
      i18nService.t('localInferenceTitle'),
      onShowLocalInference,
      'localInference',
    );
  }
  if (!isChat) {
    addView('coding', i18nService.t('codingAgent'), onShowCoding);
    addView('todo', i18nService.t('todoTitle'), onShowTodo, 'todo');
    addView(
      'scheduledTasks',
      i18nService.t('scheduledTasks'),
      onShowScheduledTasks,
      'scheduledTasks',
    );
    addView('activity', i18nService.t('activityTitle'), onShowActivity, 'activity');
    addView('expert', i18nService.t('expert'), onShowExpert, 'expert');
  }
  return (
    <SidebarNavigationView
      isChat={isChat}
      workLabel={i18nService.t('workMode')}
      chatLabel={i18nService.t('chatMode')}
      onModeChange={onWorkModeChange}
      newConversation={{
        id: 'conversation',
        icon: 'conversation',
        label: i18nService.t(isChat ? 'newChat' : 'newTask'),
        active: activeView === 'cowork' && (!isChat || activeSkillIds.length === 0),
        onClick: handleNewConversation,
        testId: 'sidebar-new-conversation',
      }}
      entries={entries}
    />
  );
};
