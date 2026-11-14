import { companionMessages } from '../../../../shared/companion/messages';
import { welcomeMessages } from '../../../../shared/desktopPet/welcomeMessages';
import { zhLocalInferenceService } from './localInferenceService';
import { zhLocalInferenceCatalog } from './localInferenceCatalog';
import { zhCoding } from './coding';
import { zhCowork } from './cowork';
import { zhScheduledTask } from './scheduledTask';
import { zhWorkbench } from './workbench';
import { zhMcpSkills } from './mcpSkills';
import { zhMarketplace } from './marketplace';
import { zhModelProviders } from './modelProviders';
import { zhSecurity } from './security';
import { zhTodoActivity } from './todoActivity';
import { zhArtifactsUpdates } from './artifactsUpdates';
import { zhSettings } from './settings';
import { zhCommon } from './common';

export const zhTranslations: Record<string, string> = {
  ...welcomeMessages.zh,
  ...companionMessages.zh,
  ...zhLocalInferenceService,
  ...zhLocalInferenceCatalog,
  ...zhCoding,
  ...zhCowork,
  ...zhScheduledTask,
  ...zhWorkbench,
  ...zhMcpSkills,
  ...zhMarketplace,
  ...zhModelProviders,
  ...zhSecurity,
  ...zhTodoActivity,
  ...zhArtifactsUpdates,
  ...zhSettings,
  ...zhCommon,
};
