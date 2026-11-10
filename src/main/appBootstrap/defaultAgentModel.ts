import { getStore } from './runtimeServices';
import { isDefenseEdition } from '../../shared/branding';
import { aisphereService } from '../extensions/aisphere';

/** The model id configured as the default for agent sessions ('' when unset). */
export const resolveDefaultAgentModelRef = (): string => {
  if (isDefenseEdition()) return aisphereService.defaultModel()?.trim() || '';
  return getStore().get<string>('magpie_default_model_id')?.trim() || '';
};
