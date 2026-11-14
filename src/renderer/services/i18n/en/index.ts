import { companionMessages } from '../../../../shared/companion/messages';
import { welcomeMessages } from '../../../../shared/desktopPet/welcomeMessages';
import { enLocalInferenceService } from './localInferenceService';
import { enLocalInferenceCatalog } from './localInferenceCatalog';
import { enCoding } from './coding';
import { enCowork } from './cowork';
import { enScheduledTask } from './scheduledTask';
import { enWorkbench } from './workbench';
import { enMcpSkills } from './mcpSkills';
import { enMarketplace } from './marketplace';
import { enModelProviders } from './modelProviders';
import { enSecurity } from './security';
import { enTodoActivity } from './todoActivity';
import { enArtifactsUpdates } from './artifactsUpdates';
import { enSettings } from './settings';
import { enCommon } from './common';

export const enTranslations: Record<string, string> = {
  ...welcomeMessages.en,
  ...companionMessages.en,
  ...enLocalInferenceService,
  ...enLocalInferenceCatalog,
  ...enCoding,
  ...enCowork,
  ...enScheduledTask,
  ...enWorkbench,
  ...enMcpSkills,
  ...enMarketplace,
  ...enModelProviders,
  ...enSecurity,
  ...enTodoActivity,
  ...enArtifactsUpdates,
  ...enSettings,
  ...enCommon,
};
