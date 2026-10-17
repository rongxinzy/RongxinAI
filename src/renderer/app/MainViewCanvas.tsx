import React, { type Dispatch, type SetStateAction } from 'react';

import { type AppUpdateRuntimeState } from '../../shared/appUpdate/constants';
import type { CodingSidebarSelection } from '../components/coding/CodingWorkspaceSidebar';
import type { ExpertTab } from '../components/expert/ExpertView';
import { LazyChunkErrorBoundary } from '../components/LazyChunkErrorBoundary';
import type { McpRegistryId } from '../components/mcp/constants';
import type { SettingsEnterpriseConfig, SettingsOpenOptions } from '../components/settings/types';
import type { CoworkPermissionRequest, CoworkPermissionResult } from '../types/cowork';
import { MainView } from './constants';
import {
  ActivityView,
  CodingWorkbenchView,
  CoworkView,
  ExpertView,
  LocalInferenceView,
  McpView,
  ScheduledTasksView,
  SettingsPage,
  SkillsView,
  TodoView,
  lazyViewFallback,
} from './lazyViews';

export interface MainViewCanvasProps {
  mainView: MainView;
  isSidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onNewChat: () => void;
  /** Settings view */
  settingsOptions: SettingsOpenOptions;
  onLeaveSettings: () => void;
  onRequestAppSettings: (options?: SettingsOpenOptions) => void;
  enterpriseConfig: SettingsEnterpriseConfig | null;
  appUpdateState: AppUpdateRuntimeState;
  managedModelsOnly: boolean;
  /** Skills / expert */
  onShowSkills: () => void;
  onCreateSkillByChat: () => void;
  onTrySkill: (skillId: string) => void;
  onChatWithExpert: (agentId: string) => void;
  expertInitialTab: ExpertTab | undefined;
  /** MCP */
  onUseMcp: (prompt?: string) => void;
  onShowConnectors: () => void;
  mcpOpenRegistryId: McpRegistryId | undefined;
  mcpOpenMarketplace: boolean;
  /** Activity */
  onShowScheduledTasks: () => void;
  /** Coding workbench */
  codingSelection: CodingSidebarSelection;
  onCodingSelectionChange: Dispatch<SetStateAction<CodingSidebarSelection>>;
  /** Local inference keep-alive view */
  hasMountedLocalInference: boolean;
  isLocalInferenceDormant: boolean;
  localInferenceInstallRequestId: string | undefined;
  localInferenceRefreshRequestId: number;
  onLocalInferenceInstallRequestHandled: (requestId: string) => void;
  onOpenModelSettings: () => void;
  /** Cowork inline permission prompts */
  currentSessionId: string | null;
  pendingPermission: CoworkPermissionRequest | null;
  isInlineAskUserQuestion: boolean;
  onRespondToPermission: (result: CoworkPermissionResult) => void | Promise<void>;
}

/**
 * Main content canvas: keeps the local-inference view alive in the background
 * and lazily renders whichever feature view is currently active.
 */
export function MainViewCanvas({
  mainView,
  isSidebarCollapsed,
  onToggleSidebar,
  onNewChat,
  settingsOptions,
  onLeaveSettings,
  onRequestAppSettings,
  enterpriseConfig,
  appUpdateState,
  managedModelsOnly,
  onShowSkills,
  onCreateSkillByChat,
  onTrySkill,
  onChatWithExpert,
  expertInitialTab,
  onUseMcp,
  onShowConnectors,
  mcpOpenRegistryId,
  mcpOpenMarketplace,
  onShowScheduledTasks,
  codingSelection,
  onCodingSelectionChange,
  hasMountedLocalInference,
  isLocalInferenceDormant,
  localInferenceInstallRequestId,
  localInferenceRefreshRequestId,
  onLocalInferenceInstallRequestHandled,
  onOpenModelSettings,
  currentSessionId,
  pendingPermission,
  isInlineAskUserQuestion,
  onRespondToPermission,
}: MainViewCanvasProps) {
  return (
    <div className={`flex-1 min-w-0 py-1.5 px-1.5 transition-[padding] duration-200 ease-out`}>
      <div
        data-main-canvas
        className="relative h-full min-h-0 rounded-xl bg-background overflow-hidden contain-[layout_style_paint]"
      >
        {hasMountedLocalInference && !isLocalInferenceDormant && !managedModelsOnly && (
          <div
            className={
              mainView === MainView.LocalInference ? 'h-full min-h-0' : 'hidden h-full min-h-0'
            }
          >
            {/* Dedicated boundary so another view's lazy chunk loading never unmounts this keep-alive view. */}
            <LazyChunkErrorBoundary resetKey={mainView}>
              <React.Suspense fallback={null}>
                <LocalInferenceView
                  installRequestId={localInferenceInstallRequestId}
                  onInstallRequestHandled={onLocalInferenceInstallRequestHandled}
                  refreshRequestId={localInferenceRefreshRequestId}
                  isSidebarCollapsed={isSidebarCollapsed}
                  isVisible={mainView === MainView.LocalInference}
                  onToggleSidebar={onToggleSidebar}
                  onNewChat={onNewChat}
                  onOpenModelSettings={onOpenModelSettings}
                  updateBadge={null}
                />
              </React.Suspense>
            </LazyChunkErrorBoundary>
          </div>
        )}
        <LazyChunkErrorBoundary resetKey={mainView}>
          <React.Suspense fallback={lazyViewFallback}>
            {mainView === MainView.Settings ? (
              <SettingsPage
                onClose={onLeaveSettings}
                initialTab={settingsOptions.initialTab}
                initialProvider={settingsOptions.initialProvider}
                notice={settingsOptions.notice}
                enterpriseConfig={enterpriseConfig}
                appUpdateState={appUpdateState}
                managedModelsOnly={managedModelsOnly}
                isSidebarCollapsed={isSidebarCollapsed}
                onToggleSidebar={onToggleSidebar}
                onNewChat={onNewChat}
              />
            ) : mainView === MainView.Skills ? (
              <SkillsView
                isSidebarCollapsed={isSidebarCollapsed}
                onToggleSidebar={onToggleSidebar}
                onNewChat={onNewChat}
                onCreateSkillByChat={onCreateSkillByChat}
                onTrySkill={onTrySkill}
                updateBadge={null}
                readOnly={enterpriseConfig?.ui?.skills === 'readonly'}
              />
            ) : mainView === MainView.ScheduledTasks ? (
              <ScheduledTasksView
                isSidebarCollapsed={isSidebarCollapsed}
                onToggleSidebar={onToggleSidebar}
                onNewChat={onNewChat}
                updateBadge={null}
              />
            ) : mainView === MainView.Activity ? (
              <ActivityView
                isSidebarCollapsed={isSidebarCollapsed}
                onToggleSidebar={onToggleSidebar}
                onNewChat={onNewChat}
                updateBadge={null}
                onShowScheduledTasks={onShowScheduledTasks}
              />
            ) : mainView === MainView.Mcp ? (
              <McpView
                isSidebarCollapsed={isSidebarCollapsed}
                onToggleSidebar={onToggleSidebar}
                onNewChat={onNewChat}
                onUseMcp={onUseMcp}
                updateBadge={null}
                openRegistryId={mcpOpenRegistryId}
                openMarketplace={mcpOpenMarketplace}
              />
            ) : mainView === MainView.Expert ? (
              <ExpertView
                isSidebarCollapsed={isSidebarCollapsed}
                onToggleSidebar={onToggleSidebar}
                onNewChat={onNewChat}
                updateBadge={null}
                readOnly={enterpriseConfig?.ui?.skills === 'readonly'}
                onCreateSkillByChat={onCreateSkillByChat}
                onTrySkill={onTrySkill}
                onChatWithExpert={onChatWithExpert}
                onUseMcp={onUseMcp}
                initialTab={expertInitialTab}
              />
            ) : mainView === MainView.Coding ? (
              <CodingWorkbenchView
                workspaceRoot={codingSelection.workspaceRoot}
                selectedLaneId={codingSelection.laneId}
                draftSession={codingSelection.draft}
                onSessionDraftCreated={onCodingSelectionChange}
                onSessionCreated={laneId =>
                  onCodingSelectionChange(current => ({ ...current, laneId, draft: null }))
                }
                onLaneSelected={laneId =>
                  onCodingSelectionChange(current => ({ ...current, laneId, draft: null }))
                }
                isSidebarCollapsed={isSidebarCollapsed}
                onToggleSidebar={onToggleSidebar}
              />
            ) : mainView === MainView.Todo ? (
              <TodoView
                isSidebarCollapsed={isSidebarCollapsed}
                onToggleSidebar={onToggleSidebar}
                onNewChat={onNewChat}
                updateBadge={null}
              />
            ) : mainView === MainView.LocalInference ? null : (
              <CoworkView
                onRequestAppSettings={onRequestAppSettings}
                onShowSkills={onShowSkills}
                onShowConnectors={onShowConnectors}
                isSidebarCollapsed={isSidebarCollapsed}
                onToggleSidebar={onToggleSidebar}
                onNewChat={onNewChat}
                updateBadge={null}
                inlineQuestionPermission={isInlineAskUserQuestion ? pendingPermission : null}
                onRespondToInlineQuestion={onRespondToPermission}
                inlinePermission={
                  pendingPermission &&
                  mainView === MainView.Cowork &&
                  pendingPermission.sessionId === currentSessionId &&
                  !isInlineAskUserQuestion
                    ? pendingPermission
                    : null
                }
                onRespondToInlinePermission={onRespondToPermission}
              />
            )}
          </React.Suspense>
        </LazyChunkErrorBoundary>
      </div>
    </div>
  );
}
