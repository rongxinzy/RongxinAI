import { zhLocalInferenceService } from './localInferenceService';
import { zhLocalInferenceCatalog } from './localInferenceCatalog';
import { zhCoding } from './coding';
import { zhCowork } from './cowork';
import { zhScheduledTask } from './scheduledTask';
import { zhIm } from './im';
import { zhWorkbench } from './workbench';
import { zhMcpSkills } from './mcpSkills';
import { zhChannels } from './channels';
import { zhMarketplace } from './marketplace';
import { zhModelProviders } from './modelProviders';
import { zhSecurity } from './security';
import { zhTodoActivity } from './todoActivity';
import { zhArtifactsUpdates } from './artifactsUpdates';
import { zhSettings } from './settings';
import { zhCommon } from './common';

export const zhTranslations: Record<string, string> = {
  ...zhLocalInferenceService,
  ...zhLocalInferenceCatalog,
  ...zhCoding,
  ...zhCowork,
  ...zhScheduledTask,
  ...zhIm,
  ...zhWorkbench,
  ...zhMcpSkills,
  ...zhChannels,
  ...zhMarketplace,
  ...zhModelProviders,
  ...zhSecurity,
  ...zhTodoActivity,
  ...zhArtifactsUpdates,
  ...zhSettings,
  ...zhCommon,
};
