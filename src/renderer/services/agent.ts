import { AgentId } from '@shared/agent';

import { CoworkSessionExpertSource } from '../../shared/cowork/sessionExperts';

import { store } from '../store';
import {
  addAgent,
  removeAgent,
  setAgents,
  setCurrentAgentId,
  setLoading,
  updateAgent as updateAgentAction,
} from '../store/slices/agentSlice';
import { clearCurrentSession } from '../store/slices/coworkSlice';
import { clearAgentSelectedModel } from '../store/slices/modelSlice';
import { clearActiveSkills, setActiveSkillIds } from '../store/slices/skillSlice';
import type { Agent } from '../types/agent';

class AgentService {
  async loadAgents(): Promise<void> {
    store.dispatch(setLoading(true));
    try {
      const agents = await window.electron?.agents?.list();
      if (agents) {
        const mappedAgents = agents.map(a => ({
          id: a.id,
          name: a.name,
          description: a.description,
          icon: a.icon,
          model: a.model ?? '',
          workingDirectory: a.workingDirectory ?? '',
          enabled: a.enabled,
          pinned: a.pinned ?? false,
          pinOrder: a.pinOrder ?? null,
          isDefault: a.isDefault,
          source: a.source,
          presetId: a.presetId ?? '',
          systemPrompt: a.systemPrompt ?? '',
          skillIds: a.skillIds ?? [],
        }));
        store.dispatch(setAgents(mappedAgents));
      }
    } catch (error) {
      console.error('Failed to load agents:', error);
    } finally {
      store.dispatch(setLoading(false));
    }
  }

  async createAgent(request: {
    name: string;
    description?: string;
    systemPrompt?: string;
    identity?: string;
    model?: string;
    workingDirectory?: string;
    icon?: string;
    skillIds?: string[];
  }): Promise<Agent | null> {
    try {
      const agent = await window.electron?.agents?.create(request);
      if (agent) {
        store.dispatch(
          addAgent({
            id: agent.id,
            name: agent.name,
            description: agent.description,
            icon: agent.icon,
            model: agent.model ?? '',
            workingDirectory: agent.workingDirectory ?? '',
            enabled: agent.enabled,
            pinned: agent.pinned ?? false,
            pinOrder: agent.pinOrder ?? null,
            isDefault: agent.isDefault,
            source: agent.source,
            presetId: agent.presetId ?? '',
            systemPrompt: agent.systemPrompt ?? '',
            skillIds: agent.skillIds ?? [],
          }),
        );
        return agent;
      }
      return null;
    } catch (error) {
      console.error('Failed to create agent:', error);
      return null;
    }
  }

  async updateAgent(
    id: string,
    updates: {
      name?: string;
      description?: string;
      systemPrompt?: string;
      identity?: string;
      model?: string;
      workingDirectory?: string;
      icon?: string;
      skillIds?: string[];
      enabled?: boolean;
      pinned?: boolean;
      triageOverride?: import('../../shared/triage').AgentTriageOverride | null;
    },
  ): Promise<Agent | null> {
    try {
      const agent = await window.electron?.agents?.update(id, updates);
      if (agent) {
        store.dispatch(
          updateAgentAction({
            id: agent.id,
            updates: {
              name: agent.name,
              description: agent.description,
              icon: agent.icon,
              model: agent.model ?? '',
              workingDirectory: agent.workingDirectory ?? '',
              enabled: agent.enabled,
              pinned: agent.pinned ?? false,
              pinOrder: agent.pinOrder ?? null,
              skillIds: agent.skillIds ?? [],
            },
          }),
        );
        // If the edited agent is the currently active one, sync skillIds
        // to the runtime skill slice so new conversations pick up changes
        // immediately (switchAgent handles this on explicit switch, but
        // in-place editing without switching was missing the sync).
        if (id === store.getState().agent.currentAgentId && updates.skillIds !== undefined) {
          store.dispatch(setActiveSkillIds(agent.skillIds ?? []));
        }
        return agent;
      }
      return null;
    } catch (error) {
      console.error('Failed to update agent:', error);
      return null;
    }
  }

  async deleteAgent(id: string): Promise<boolean> {
    try {
      const wasCurrentAgent = store.getState().agent.currentAgentId === id;
      const deleted = await window.electron?.agents?.delete(id);
      if (!deleted) {
        return false;
      }
      store.dispatch(removeAgent(id));
      store.dispatch(clearAgentSelectedModel(id));
      if (wasCurrentAgent) {
        this.switchAgent(AgentId.Main);
        const { coworkService } = await import('./cowork');
        coworkService.loadSessions(AgentId.Main);
      }
      return true;
    } catch (error) {
      console.error('Failed to delete agent:', error);
      return false;
    }
  }

  async importExpertPackage(
    expertDir: string,
  ): Promise<{
    success: boolean;
    agentIds?: string[];
    expertType?: string;
    name?: string;
    error?: string;
  }> {
    try {
      const result = await window.electron?.agents?.importExpertPackage(expertDir);
      if (result?.success) {
        await this.loadAgents();
      }
      return result ?? { success: false, error: 'Import not supported' };
    } catch (error) {
      console.error('Failed to import expert package:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to import expert package',
      };
    }
  }

  switchAgent(agentId: string): void {
    store.dispatch(setCurrentAgentId(agentId));
    store.dispatch(clearCurrentSession());
    const agent = store.getState().agent.agents.find(a => a.id === agentId);
    const isExpertAgent =
      agent?.source === CoworkSessionExpertSource.Package ||
      agent?.source === CoworkSessionExpertSource.Member;
    if (agent?.skillIds?.length && !isExpertAgent) {
      store.dispatch(setActiveSkillIds(agent.skillIds));
    } else {
      store.dispatch(clearActiveSkills());
    }
  }
}

export const agentService = new AgentService();
