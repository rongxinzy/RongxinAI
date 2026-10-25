import { catalogCopy } from './magpieCopy/catalog';
import { externalAgentsCopy } from './magpieCopy/externalAgents';
import { providersCopy } from './magpieCopy/providers';
import { routingCopy } from './magpieCopy/routing';

export const magpieTranslations = {
  zh: {
    ...catalogCopy.zh,
    ...externalAgentsCopy.zh,
    ...providersCopy.zh,
    ...routingCopy.zh,
  },
  en: {
    ...catalogCopy.en,
    ...externalAgentsCopy.en,
    ...providersCopy.en,
    ...routingCopy.en,
  },
};
