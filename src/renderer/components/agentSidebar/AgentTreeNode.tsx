import { Button } from '@shared/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@shared/components/ui/dropdown-menu';
import { Bot, Ellipsis, Pencil, Pin, Trash2 } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { i18nService } from '../../services/i18n';
import { getAgentDisplayName, isDefaultAgentId, shouldUseDefaultAgentIcon } from '../../utils/agentDisplay';
import AgentAvatarIcon from '../agent/AgentAvatarIcon';
import AgentConfirmDialog from '../agent/AgentConfirmDialog';
import { AgentConfirmDialogVariant } from '../agent/constants';
import AgentTaskRow from './AgentTaskRow';
import ExpandAgentTasksRow from './ExpandAgentTasksRow';
import type { AgentSidebarAgentNode, AgentSidebarTaskNode } from './types';

interface AgentTreeNodeProps {
  agent: AgentSidebarAgentNode;
  isBatchMode: boolean;
  selectedIds: Set<string>;
  showBatchOption?: boolean;
  onToggleExpanded: (agentId: string) => void;
  onEditAgent: (agent: AgentSidebarAgentNode) => void;
  onCreateTask: (agent: AgentSidebarAgentNode) => void;
  onDeleteAgent: (agent: AgentSidebarAgentNode) => Promise<void>;
  onToggleAgentPin: (agent: AgentSidebarAgentNode, pinned: boolean) => Promise<void>;
  onRetryLoadTasks: (agentId: string) => void;
  onLoadMoreTasks: (agentId: string) => void;
  onCollapseTasks: (agentId: string) => void;
  onSelectTask: (task: AgentSidebarTaskNode) => void;
  onDeleteTask: (task: AgentSidebarTaskNode) => Promise<void>;
  onShareTask: (task: AgentSidebarTaskNode) => Promise<void>;
  onToggleTaskPin: (task: AgentSidebarTaskNode, pinned: boolean) => Promise<void>;
  onRenameTask: (task: AgentSidebarTaskNode, title: string) => Promise<void>;
  onToggleSelection: (sessionId: string) => void;
  onEnterBatchMode: (task: AgentSidebarTaskNode) => void;
}

const AGENT_TASKS_TRANSITION_MS = 200;

const AgentAvatar: React.FC<{ agent: AgentSidebarAgentNode }> = ({ agent }) => {
  if (shouldUseDefaultAgentIcon(agent)) return <Bot className="h-4 w-4" />;
  return (
    <AgentAvatarIcon value={agent.icon} className="h-4 w-4" iconClassName="h-4 w-4"
      fallbackText={getAgentDisplayName(agent).trim().slice(0, 1).toUpperCase() || 'A'} />
  );
};

const AgentTreeNode: React.FC<AgentTreeNodeProps> = ({
  agent, isBatchMode, selectedIds, showBatchOption,
  onToggleExpanded, onEditAgent, onCreateTask, onDeleteAgent, onToggleAgentPin,
  onRetryLoadTasks, onLoadMoreTasks, onCollapseTasks,
  onSelectTask, onDeleteTask, onShareTask, onToggleTaskPin, onRenameTask,
  onToggleSelection, onEnterBatchMode,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [shouldRenderTasks, setShouldRenderTasks] = useState(agent.isExpanded);
  const [isTaskGroupVisible, setIsTaskGroupVisible] = useState(agent.isExpanded);
  const [isTaskGroupTransitioning, setIsTaskGroupTransitioning] = useState(false);
  const previousExpandedRef = useRef(agent.isExpanded);
  const isMainAgent = isDefaultAgentId(agent.id);
  const agentName = getAgentDisplayName(agent);

  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const handleEditAgent = () => { closeMenu(); onEditAgent(agent); };
  const handleCreateTask = () => { closeMenu(); onCreateTask(agent); };
  const handleDeleteMenuClick = () => { if (isMainAgent) return; closeMenu(); setShowConfirmDelete(true); };
  const handleToggleAgentPin = () => { closeMenu(); void onToggleAgentPin(agent, !agent.pinned); };

  useEffect(() => {
    let af: number; let to: number;
    const wasExpanded = previousExpandedRef.current;
    previousExpandedRef.current = agent.isExpanded;
    if (wasExpanded === agent.isExpanded) return;
    if (agent.isExpanded) {
      setShouldRenderTasks(true); setIsTaskGroupVisible(false); setIsTaskGroupTransitioning(true);
      af = requestAnimationFrame(() => {
        af = requestAnimationFrame(() => {
          setIsTaskGroupVisible(true);
          to = window.setTimeout(() => setIsTaskGroupTransitioning(false), AGENT_TASKS_TRANSITION_MS);
        });
      });
    } else {
      setIsTaskGroupTransitioning(true); setIsTaskGroupVisible(false);
      to = window.setTimeout(() => { setShouldRenderTasks(false); setIsTaskGroupTransitioning(false); }, AGENT_TASKS_TRANSITION_MS);
    }
    return () => { if (af) cancelAnimationFrame(af); if (to) clearTimeout(to); };
  }, [agent.isExpanded]);

  return (
    <div className="space-y-0.5">
      <div className={`group sticky top-10 ${menuOpen ? 'z-50' : 'z-20'} -ml-[6px] h-7 w-[calc(100%+12px)] bg-surface-raised`}>
        <Button
          variant="ghost"
          className="flex h-full w-full items-center !justify-start gap-2 rounded-md py-0 pl-3.5 pr-12 text-[14px] font-normal text-foreground"
          onClick={() => onToggleExpanded(agent.id)}
          role="treeitem" aria-level={1} aria-expanded={agent.isExpanded}
        >
          <span className="flex h-4 w-4 shrink-0 items-center justify-center"><AgentAvatar agent={agent} /></span>
          <span className="min-w-0 flex-1 truncate opacity-[0.76]">{agentName}</span>
        </Button>

        <div className={`absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5 transition-opacity ${menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger>
              <Button variant="ghost" size="icon-xs" className="opacity-[0.3] hover:opacity-[0.46]" aria-label={i18nService.t('coworkSessionActions')}>
                <Ellipsis className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[104px]">
              <DropdownMenuItem onClick={handleEditAgent}><Pencil className="h-3.5 w-3.5" /> {i18nService.t('edit')}</DropdownMenuItem>
              <DropdownMenuItem onClick={handleToggleAgentPin}><Pin className="h-3.5 w-3.5" /> {agent.pinned ? i18nService.t('agentUnpin') : i18nService.t('agentPin')}</DropdownMenuItem>
              {isMainAgent ? (
                <DropdownMenuItem disabled title={i18nService.t('agentDefaultCannotDelete')}>
                  <Trash2 className="h-3.5 w-3.5" /> {i18nService.t('delete')}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem className="text-red-500 focus:text-red-500" onClick={handleDeleteMenuClick}>
                  <Trash2 className="h-3.5 w-3.5" /> {i18nService.t('delete')}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="icon-xs" onClick={handleCreateTask} className="opacity-[0.3] hover:opacity-[0.46]" aria-label={i18nService.t('myAgentSidebarNewTask')}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        </div>

        {showConfirmDelete && (
          <AgentConfirmDialog variant={AgentConfirmDialogVariant.Delete}
            title={i18nService.t('agentDeleteConfirmTitle')}
            message={i18nService.t('agentDeleteConfirmMessage').replace('{name}', agentName)}
            cancelLabel={i18nService.t('cancel')} confirmLabel={i18nService.t('delete')}
            onCancel={() => setShowConfirmDelete(false)}
            onConfirm={() => { setShowConfirmDelete(false); void onDeleteAgent(agent); }} />
        )}
      </div>

      {shouldRenderTasks && (
        <div className={`grid w-full min-w-0 max-w-full transition-all duration-200 ease-out motion-reduce:transition-none ${isTaskGroupVisible ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
          <div className={`min-h-0 min-w-0 max-w-full ${isTaskGroupVisible && !isTaskGroupTransitioning ? 'overflow-visible' : 'overflow-hidden'} ${isTaskGroupVisible ? '' : 'pointer-events-none'}`}
            role="group" aria-hidden={!agent.isExpanded}>
            <div className="min-w-0 max-w-full space-y-0.5">
              {agent.hasLoadError && agent.tasks.length === 0 && (
                <Button variant="ghost" onClick={() => onRetryLoadTasks(agent.id)}
                  className="-ml-[6px] flex h-7 w-[calc(100%+12px)] justify-start rounded-md pl-[38px] pr-2.5 text-[13px] font-normal text-red-500 hover:bg-red-500/10">
                  {i18nService.t('myAgentSidebarLoadFailed')}
                </Button>
              )}
              {agent.isLoadingTasks && agent.tasks.length === 0 && (
                <div className="-ml-[6px] flex h-7 w-[calc(100%+12px)] items-center pl-[38px] pr-2.5 text-[13px] text-muted-foreground">{i18nService.t('loading')}</div>
              )}
              {!agent.isLoadingTasks && !agent.hasLoadError && agent.tasks.length === 0 && (
                <div className="-ml-[6px] flex h-7 w-[calc(100%+12px)] items-center pl-[38px] pr-2.5 text-[13px] text-foreground opacity-[0.28]">{i18nService.t('myAgentSidebarNoTasks')}</div>
              )}
              {agent.tasks.map((task) => (
                <AgentTaskRow key={task.id} task={task} isBatchMode={isBatchMode} isSelected={selectedIds.has(task.id)}
                  showBatchOption={showBatchOption} onSelect={() => onSelectTask(task)} onDelete={() => onDeleteTask(task)}
                  onShare={() => onShareTask(task)} onTogglePin={(p) => onToggleTaskPin(task, p)}
                  onRename={(t) => onRenameTask(task, t)} onToggleSelection={() => onToggleSelection(task.id)}
                  onEnterBatchMode={() => onEnterBatchMode(task)} />
              ))}
              {agent.hasLoadError && agent.tasks.length > 0 && (
                <Button variant="ghost" onClick={() => onRetryLoadTasks(agent.id)}
                  className="-ml-[6px] flex h-7 w-[calc(100%+12px)] justify-start rounded-md pl-[38px] pr-2.5 text-[13px] font-normal text-red-500 hover:bg-red-500/10">
                  {i18nService.t('myAgentSidebarLoadFailed')}
                </Button>
              )}
              {agent.canExpandTasks && <ExpandAgentTasksRow isLoading={agent.isLoadingTasks} label={i18nService.t('myAgentSidebarExpandMore')} onClick={() => onLoadMoreTasks(agent.id)} />}
              {agent.canCollapseTasks && <ExpandAgentTasksRow isLoading={false} label={i18nService.t('myAgentSidebarCollapse')} onClick={() => onCollapseTasks(agent.id)} />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AgentTreeNode;
