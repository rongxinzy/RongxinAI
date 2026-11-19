import { getStore } from './runtimeServices';
import { isRetiredHostModel } from '../magpie/hostProviders';

/** The model id configured as the default for agent sessions ('' when unset). */
export const resolveDefaultAgentModelRef = (): string => {
  const modelRef = getStore().get<string>('magpie_default_model_id')?.trim() ?? '';
  return isRetiredHostModel(modelRef) ? '' : modelRef;
};
