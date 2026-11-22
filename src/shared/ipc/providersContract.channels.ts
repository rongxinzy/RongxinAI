/**
 * Channel map for the provider-domain IPC contract, importable by the sandboxed
 * preload. Kept in a separate zod-free module because the preload bundle must
 * not require zod; the type argument locks the map to the contract's channels.
 */
import type { IpcContractChannels } from './contract';
import type { providersContract } from './providersContract';
import { CommunityAuthIpc, EnterpriseIpc, ManagedProviderIpc } from './channels';
import { AgentIpcChannel } from '../agent/constants';
import { AISphereIpc } from '../aisphere';
import { EnterpriseSessionIpc } from '../enterpriseSession';
import { EnterpriseRendererIpc } from '../enterpriseRenderer';

export const providersContractChannels: IpcContractChannels<typeof providersContract> = {
  agentsList: AgentIpcChannel.List,
  agentsGet: AgentIpcChannel.Get,
  agentsCreate: AgentIpcChannel.Create,
  agentsUpdate: AgentIpcChannel.Update,
  agentsDelete: AgentIpcChannel.Delete,
  agentsImportExpertPackage: AgentIpcChannel.ImportExpertPackage,
  agentsGetPresetExperts: AgentIpcChannel.GetPresetExperts,
  enterpriseGetConfig: EnterpriseIpc.GetConfig,
  enterpriseSessionGateEntrypoint: EnterpriseRendererIpc.SessionGateEntrypoint,
  enterpriseSettingsPages: EnterpriseRendererIpc.SettingsPages,
  enterpriseSessionSnapshot: EnterpriseSessionIpc.Snapshot,
  enterpriseSessionLogin: EnterpriseSessionIpc.Login,
  enterpriseSessionChangePassword: EnterpriseSessionIpc.ChangePassword,
  enterpriseSessionLogout: EnterpriseSessionIpc.Logout,
  managedProviderPolicy: ManagedProviderIpc.Policy,
  managedProviderCatalog: ManagedProviderIpc.Catalog,
  aisphereSnapshot: AISphereIpc.Snapshot,
  aisphereConnect: AISphereIpc.Connect,
  aisphereDisconnect: AISphereIpc.Disconnect,
  aisphereRefresh: AISphereIpc.Refresh,
  authCommunityLogin: CommunityAuthIpc.Login,
  authGetCommunityUser: CommunityAuthIpc.GetCommunityUser,
  authCommunityLogout: CommunityAuthIpc.Logout,
} as const;

export const MagpieIpc = {
  status: 'magpie:status',
  start: 'magpie:start',
  stop: 'magpie:stop',
  agents: 'magpie:agents',
  setModel: 'magpie:setModel',
  previewAgent: 'magpie:previewAgent',
  connectAgent: 'magpie:connectAgent',
  disconnectAgent: 'magpie:disconnectAgent',
  disconnectAllAgents: 'magpie:disconnectAllAgents',
  catalog: 'magpie:catalog',
  selectDefault: 'magpie:selectDefault',
  setSubscriptionAccounts: 'magpie:setSubscriptionAccounts',
  providers: 'magpie:providers',
  saveProvider: 'magpie:saveProvider',
  setProviderEnabled: 'magpie:setProviderEnabled',
  deleteProvider: 'magpie:deleteProvider',
  testProvider: 'magpie:testProvider',
  diagnostics: 'magpie:diagnostics',
  clearDiagnostics: 'magpie:clearDiagnostics',
  preferences: 'magpie:preferences',
  updatePreferences: 'magpie:updatePreferences',
  routingGroups: 'magpie:routingGroups',
  saveRoutingGroup: 'magpie:saveRoutingGroup',
  deleteRoutingGroup: 'magpie:deleteRoutingGroup',
  arrangeRoutingGroups: 'magpie:arrangeRoutingGroups',
  usageSummary: 'magpie:usageSummary',
  usageRequests: 'magpie:usageRequests',
  usageQuotas: 'magpie:usageQuotas',
  usageBudget: 'magpie:usageBudget',
} as const;
