import { enLocalInferenceService } from './localInferenceService';
import { enLocalInferenceCatalog } from './localInferenceCatalog';
import { enCoding } from './coding';
import { enCowork } from './cowork';
import { enScheduledTask } from './scheduledTask';
import { enIm } from './im';
import { enWorkbench } from './workbench';
import { enMcpSkills } from './mcpSkills';
import { enChannels } from './channels';
import { enMarketplace } from './marketplace';
import { enModelProviders } from './modelProviders';
import { enSecurity } from './security';
import { enTodoActivity } from './todoActivity';
import { enArtifactsUpdates } from './artifactsUpdates';
import { enSettings } from './settings';
import { enCommon } from './common';

export const enTranslations: Record<string, string> = {
  ...enLocalInferenceService,
  ...enLocalInferenceCatalog,
  ...enCoding,
  ...enCowork,
  ...enScheduledTask,
  ...enIm,
  ...enWorkbench,
  ...enMcpSkills,
  ...enChannels,
  ...enMarketplace,
  ...enModelProviders,
  ...enSecurity,
  ...enTodoActivity,
  ...enArtifactsUpdates,
  ...enSettings,
  ...enCommon,
};
