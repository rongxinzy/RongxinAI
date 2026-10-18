/**
 * Channel map for the skills IPC contract, importable by the sandboxed
 * preload. Kept in a separate zod-free module because the preload bundle must
 * not require zod; the type argument locks the map to the contract's channels.
 */
import type { IpcContractChannels } from './contract';
import type { skillsContract } from './skillsContract';
import { SkillsIpc } from './channels';

export const skillsContractChannels: IpcContractChannels<typeof skillsContract> = {
  list: SkillsIpc.List,
  setEnabled: SkillsIpc.SetEnabled,
  setEnabledBatch: SkillsIpc.SetEnabledBatch,
  setPinned: SkillsIpc.SetPinned,
  delete: SkillsIpc.Delete,
  download: SkillsIpc.Download,
  confirmInstall: SkillsIpc.ConfirmInstall,
  getRoot: SkillsIpc.GetRoot,
  getContent: SkillsIpc.GetContent,
  autoRoutingPrompt: SkillsIpc.AutoRoutingPrompt,
  getConfig: SkillsIpc.GetConfig,
  setConfig: SkillsIpc.SetConfig,
  testEmailConnectivity: SkillsIpc.TestEmailConnectivity,
  fetchMarketplace: SkillsIpc.FetchMarketplace,
  fetchMarketplaceContent: SkillsIpc.FetchMarketplaceContent,
  createCustom: SkillsIpc.CreateCustom,
} as const;
