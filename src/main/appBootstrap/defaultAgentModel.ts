import { getStore } from './runtimeServices';
import { getBranding } from '../../shared/branding';
import { isRetiredHostModel } from '../magpie/hostProviders';
import { MAGPIE_DEFAULT_MODEL_ID_KEY } from '../magpie/modelService';
import { aisphereService } from '../extensions/aisphere';

/** The model id configured as the default for agent sessions ('' when unset). */
export const resolveDefaultAgentModelRef = (): string => {
  if (getBranding().features.enableAISphere) return aisphereService.defaultModelRef();
  const modelRef = getStore().get<string>(MAGPIE_DEFAULT_MODEL_ID_KEY)?.trim() ?? '';
  return isRetiredHostModel(modelRef) ? '' : modelRef;
};
