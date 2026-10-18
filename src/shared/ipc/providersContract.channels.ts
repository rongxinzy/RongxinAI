/**
 * Channel map for the provider-domain IPC contract, importable by the sandboxed
 * preload. Kept in a separate zod-free module because the preload bundle must
 * not require zod; the type argument locks the map to the contract's channels.
 */
import type { IpcContractChannels } from './contract';
import type { providersContract } from './providersContract';
import { CommunityAuthIpc, EnterpriseIpc, ManagedProviderIpc, ModelPoolIpc } from './channels';
import { AgentIpcChannel } from '../agent/constants';
import { AISphereIpc } from '../aisphere';
import { EnterpriseSessionIpc } from '../enterpriseSession';
import { EnterpriseRendererIpc } from '../enterpriseRenderer';
import { MagpieIpc } from '../magpie/types';

export const providersContractChannels: IpcContractChannels<typeof providersContract> = {
  agentsList: AgentIpcChannel.List,
  agentsGet: AgentIpcChannel.Get,
  agentsCreate: AgentIpcChannel.Create,
  agentsUpdate: AgentIpcChannel.Update,
  agentsDelete: AgentIpcChannel.Delete,
  agentsImportExpertPackage: AgentIpcChannel.ImportExpertPackage,
  agentsGetPresetExperts: AgentIpcChannel.GetPresetExperts,
  magpieStatus: MagpieIpc.status,
  magpieSetSubscriptionAccounts: MagpieIpc.setSubscriptionAccounts,
  magpieStart: MagpieIpc.start,
  magpieStop: MagpieIpc.stop,
  magpieAgents: MagpieIpc.agents,
  magpieSetModel: MagpieIpc.setModel,
  magpiePreviewAgent: MagpieIpc.previewAgent,
  magpieConnectAgent: MagpieIpc.connectAgent,
  magpieDisconnectAgent: MagpieIpc.disconnectAgent,
  magpieDisconnectAllAgents: MagpieIpc.disconnectAllAgents,
  magpieModels: MagpieIpc.models,
  magpieCatalog: MagpieIpc.catalog,
  magpieSelectDefault: MagpieIpc.selectDefault,
  magpieProviders: MagpieIpc.providers,
  magpieSaveProvider: MagpieIpc.saveProvider,
  magpieSetProviderEnabled: MagpieIpc.setProviderEnabled,
  magpieDeleteProvider: MagpieIpc.deleteProvider,
  magpieTestProvider: MagpieIpc.testProvider,
  magpieDiagnostics: MagpieIpc.diagnostics,
  magpiePreferences: MagpieIpc.preferences,
  magpieUpdatePreferences: MagpieIpc.updatePreferences,
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
  aisphereRefresh: AISphereIpc.Refresh,
  authCommunityLogin: CommunityAuthIpc.Login,
  authGetCommunityUser: CommunityAuthIpc.GetCommunityUser,
  authCommunityLogout: CommunityAuthIpc.Logout,
  modelPoolListModels: ModelPoolIpc.ListModels,
  modelPoolStream: ModelPoolIpc.Stream,
  modelPoolCancelStream: ModelPoolIpc.CancelStream,
} as const;
