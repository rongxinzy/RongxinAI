import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';

import { agentService } from '../../services/agent';
import { coworkService } from '../../services/cowork';
import { i18nService } from '../../services/i18n';
import { RootState } from '../../store';
import { isDefaultAgentId } from '../../utils/agentDisplay';
import AgentCreateModal from '../agent/AgentCreateModal';
import AgentSettingsPanel from '../agent/AgentSettingsPanel';
import { type CoworkOpenShareOptionsEventDetail,CoworkUiEvent } from '../cowork/constants';
import AgentTreeNode from './AgentTreeNode';
import MyAgentSidebarHeader from './MyAgentSidebarHeader';
import type { AgentSidebarAgentNode, AgentSidebarTaskNode } from './types';
import { useAgentSidebarState } from './useAgentSidebarState';

interface MyAgentSidebarTreeProps {
  isBatchMode: boolean;
  selectedIds: Set<string>;
  onShowCowork: () => void;
  onToggleSelection: (sessionId: string) => void;
  onEnterBatchMode: (sessionId: string) => void;
  /** 上报当前侧边栏树中所有可见 session ID，供批量全选使用 */
  onVisibleSessionsChange?: (ids: string[]) => void;
}

const MyAgentSidebarTree: React.FC<MyAgentSidebarTreeProps> = ({
  isBatchMode,
  selectedIds,
  onShowCowork,
  onToggleSelection,
  onEnterBatchMode,
  onVisibleSessionsChange,
}) => {
  const currentAgentId = useSelector((state: RootState) => state.agent.currentAgentId);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [settingsAgentId, setSettingsAgentId] = useState<string | null>(null);
  const {
    agentNodes,
    patchTaskPreview,
    removeTaskPreview,
    retryLoadTasks,
    loadMoreTasks,
    collapseTasks,
    toggleAgentExpanded,
  } = useAgentSidebarState();

  useEffect(() => {
    void agentService.loadAgents();
  }, []);

  // 每当 agentNodes 变化时，将当前侧边栏树中所有可见的 task ID
  // 上报给父组件，供批量模式"全选"功能使用，确保跨 Agent 全选正确
  useEffect(() => {
    if (!onVisibleSessionsChange) return;
    const ids: string[] = [];
    agentNodes.forEach((agent) => {
      agent.tasks.forEach((task) => {
        ids.push(task.id);
      });
    });
    onVisibleSessionsChange(ids);
  }, [agentNodes, onVisibleSessionsChange]);

  const handleSelectTask = async (task: AgentSidebarTaskNode) => {
    if (task.agentId !== currentAgentId) {
      agentService.switchAgent(task.agentId);
      await coworkService.loadSessions(task.agentId);
    }
    onShowCowork();
    return coworkService.loadSession(task.id);
  };

  const handleDeleteTask = async (task: AgentSidebarTaskNode) => {
    const deleted = await coworkService.deleteSession(task.id);
    if (deleted) {
      removeTaskPreview(task.id);
    }
  };

  const handleToggleTaskPin = async (task: AgentSidebarTaskNode, pinned: boolean) => {
    const result = await coworkService.setSessionPinned(task.id, pinned);
    if (result.success) {
      patchTaskPreview(task.id, { pinned, pinOrder: result.pinOrder }, { preserveUpdatedAt: true });
    }
  };

  const handleRenameTask = async (task: AgentSidebarTaskNode, title: string) => {
    const renamed = await coworkService.renameSession(task.id, title);
    if (renamed) {
      patchTaskPreview(task.id, { title });
    }
  };

  const handleShareTask = async (task: AgentSidebarTaskNode) => {
    const session = await handleSelectTask(task);
    if (!session) return;

    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent<CoworkOpenShareOptionsEventDetail>(
        CoworkUiEvent.OpenShareOptions,
        { detail: { sessionId: task.id } },
      ));
    }, 0);
  };

  const handleEnterBatchMode = (task: AgentSidebarTaskNode) => {
    if (task.agentId !== currentAgentId) {
      agentService.switchAgent(task.agentId);
      void coworkService.loadSessions(task.agentId);
    }
    onEnterBatchMode(task.id);
  };

  const handleCreateTask = async (agent: AgentSidebarAgentNode) => {
    if (agent.id !== currentAgentId) {
      agentService.switchAgent(agent.id);
      await coworkService.loadSessions(agent.id);
    }
    coworkService.clearSession();
    onShowCowork();
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('cowork:focus-input', {
        detail: { clear: false },
      }));
    }, 0);
  };

  const handleDeleteAgent = async (agent: AgentSidebarAgentNode) => {
    if (isDefaultAgentId(agent.id)) return;
    const deleted = await agentService.deleteAgent(agent.id);
    if (deleted && settingsAgentId === agent.id) {
      setSettingsAgentId(null);
    }
    if (!deleted) {
      window.dispatchEvent(new CustomEvent('app:showToast', { detail: i18nService.t('agentDeleteFailed') }));
    }
  };

  const handleToggleAgentPin = async (agent: AgentSidebarAgentNode, pinned: boolean) => {
    const updated = await agentService.updateAgent(agent.id, { pinned });
    if (!updated) {
      window.dispatchEvent(new CustomEvent('app:showToast', { detail: i18nService.t('agentPinFailed') }));
    }
  };

  const renderAgentNode = (agent: AgentSidebarAgentNode) => (
    <AgentTreeNode
      key={agent.id}
      agent={agent}
      isBatchMode={isBatchMode}
      selectedIds={selectedIds}
      showBatchOption
      onToggleExpanded={toggleAgentExpanded}
      onEditAgent={(agent) => setSettingsAgentId(agent.id)}
      onCreateTask={(agent) => void handleCreateTask(agent)}
      onDeleteAgent={handleDeleteAgent}
      onToggleAgentPin={handleToggleAgentPin}
      onRetryLoadTasks={(agentId) => void retryLoadTasks(agentId)}
      onLoadMoreTasks={(agentId) => void loadMoreTasks(agentId)}
      onCollapseTasks={collapseTasks}
      onSelectTask={(task) => void handleSelectTask(task)}
      onDeleteTask={handleDeleteTask}
      onShareTask={handleShareTask}
      onToggleTaskPin={handleToggleTaskPin}
      onRenameTask={handleRenameTask}
      onToggleSelection={onToggleSelection}
      onEnterBatchMode={handleEnterBatchMode}
    />
  );

  const pinnedAgentNodes = agentNodes.filter((agent) => agent.pinned);
  const projectAgentNodes = agentNodes.filter((agent) => !agent.pinned);
  const hasPinnedAgents = pinnedAgentNodes.length > 0;

  return (
    <div className="pb-3" role="tree" aria-label={i18nService.t('myAgents')}>
      {hasPinnedAgents && (
        <div className="space-y-0.5">
          <div className="sticky top-0 z-30 flex h-10 items-center bg-surface-raised px-1.5">
            <h2 className="min-w-0 truncate text-[14px] font-normal text-foreground opacity-[0.28]">
              {i18nService.t('myAgentSidebarPinned')}
            </h2>
          </div>
          {pinnedAgentNodes.map(renderAgentNode)}
        </div>
      )}

      <MyAgentSidebarHeader
        onCreateAgent={() => setIsCreateOpen(true)}
      />

      {agentNodes.length === 0 ? (
        <div className="px-3 py-6 text-center">
          <p className="text-xs font-medium text-secondary">
            {i18nService.t('myAgentSidebarNoAgents')}
          </p>
          <button
            type="button"
            onClick={() => setIsCreateOpen(true)}
            className="mt-3 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-hover"
          >
            {i18nService.t('createNewAgent')}
          </button>
        </div>
      ) : projectAgentNodes.length > 0 ? (
        <div className="space-y-0.5 px-0">
          {projectAgentNodes.map(renderAgentNode)}
        </div>
      ) : null}

      <AgentCreateModal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} />
      <AgentSettingsPanel
        agentId={settingsAgentId}
        onClose={() => setSettingsAgentId(null)}
      />
    </div>
  );
};

export default MyAgentSidebarTree;
