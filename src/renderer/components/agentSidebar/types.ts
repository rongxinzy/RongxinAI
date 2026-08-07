import type { CoworkSessionStatus } from '../../types/cowork';
import type { AgentSidebarIndicator } from './constants';

export interface AgentSidebarAgentSummary {
  id: string;
  name: string;
  icon: string;
  enabled: boolean;
  pinned: boolean;
  pinOrder?: number | null;
}

export interface AgentSidebarTaskNode {
  id: string;
  agentId: string;
  workspaceId?: string;
  title: string;
  status: CoworkSessionStatus;
  pinned: boolean;
  pinOrder?: number | null;
  updatedAt: number;
  createdAt: number;
  indicator: AgentSidebarIndicator;
  isSelected: boolean;
}

export interface AgentSidebarAgentNode extends AgentSidebarAgentSummary {
  isExpanded: boolean;
  isTaskListExpanded: boolean;
  canExpandTasks: boolean;
  canCollapseTasks: boolean;
  isLoadingTasks: boolean;
  hasLoadError: boolean;
  tasks: AgentSidebarTaskNode[];
}

export interface WorkspaceSidebarNode {
  id: string;
  name: string;
  path: string;
  pinned?: boolean;
  isExpanded: boolean;
  isTaskListExpanded: boolean;
  canExpandTasks: boolean;
  canCollapseTasks: boolean;
  isLoadingTasks: boolean;
  hasLoadError: boolean;
  tasks: AgentSidebarTaskNode[];
}

export interface AgentSidebarPreferenceState {
  expandedAgentIds: string[];
  expandedTaskListAgentIds: string[];
  selectedAgentId?: string;
  selectedTaskId?: string;
}

export interface WorkspaceSidebarPreferenceState {
  expandedWorkspaceIds: string[];
  expandedTaskListWorkspaceIds: string[];
  scheduledExpandedWorkspaceIds?: string[];
  scheduledExpandedTaskListWorkspaceIds?: string[];
}
