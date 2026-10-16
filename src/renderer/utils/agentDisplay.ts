import { AgentId, DefaultAgentProfile, LegacyAgentName } from '@shared/agent';

import { i18nService } from '../services/i18n';

interface AgentDisplaySource {
  id: string;
  name?: string;
  icon?: string;
}

const isDefaultAgentId = (agentId?: string | null): boolean => {
  return agentId?.trim() === AgentId.Main;
};

const isDefaultAgentProfileName = (agent: Pick<AgentDisplaySource, 'id' | 'name'>): boolean => {
  if (!isDefaultAgentId(agent.id)) return false;
  const normalizedName = agent.name?.trim() ?? '';
  return (
    !normalizedName ||
    normalizedName.toLowerCase() === LegacyAgentName.Main ||
    normalizedName === DefaultAgentProfile.Name
  );
};

const getAgentDisplayName = (agent: Pick<AgentDisplaySource, 'id' | 'name'>): string => {
  if (isDefaultAgentProfileName(agent)) {
    return i18nService.t('defaultAgentDisplayName');
  }

  const normalizedName = agent.name?.trim();
  return normalizedName || agent.id;
};

export const getAgentDisplayNameById = (
  agentId: string,
  agents: Array<Pick<AgentDisplaySource, 'id' | 'name'>>,
): string | null => {
  const normalizedAgentId = agentId.trim();
  if (!normalizedAgentId) return null;

  const agent = agents.find(item => item.id === normalizedAgentId);
  if (agent) return getAgentDisplayName(agent);

  if (isDefaultAgentId(normalizedAgentId)) {
    return i18nService.t('defaultAgentDisplayName');
  }

  return normalizedAgentId;
};
