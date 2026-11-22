import { CompanionTasks } from '../companion/tasks';
import { CompanionChat } from '../companion/chat';
import { CompanionProfiles } from '../companion/profiles';
import type { MagpieModelService } from '../magpie/modelService';
import type { PiRuntimeAdapter } from '../libs/agentEngine/piRuntimeAdapter';
import { getStore } from './runtimeServices';
import { coworkSessionDependencies } from './sessionServices';

function createCompanionServices(models: MagpieModelService, runtime: PiRuntimeAdapter) {
  const store = getStore();
  const db = store.getDatabase();
  return {
    companions: {
      profiles: new CompanionProfiles(store),
      chat: new CompanionChat(db, models, runtime),
    },
    tasks: new CompanionTasks({
      db,
      models,
      sessions: coworkSessionDependencies,
    }),
  };
}

let services: ReturnType<typeof createCompanionServices> | undefined;

export function initializeCompanionServices(
  models: MagpieModelService,
  runtime: PiRuntimeAdapter,
): void {
  services ??= createCompanionServices(models, runtime);
}

export function interruptCompanionChat(): void {
  services?.companions.chat.interrupt();
}

export function getCompanionServices() {
  if (!services) throw new Error('Companion services are not initialized');
  return services;
}
