import { getStore } from './runtimeServices';

/** The model id configured as the default for agent sessions ('' when unset). */
export const resolveDefaultAgentModelRef = (): string => {
  return getStore().get<string>('magpie_default_model_id')?.trim() || '';
};
