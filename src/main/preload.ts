import { contextBridge } from 'electron';
import { isDefenseEdition } from '../shared/branding';

import { appSystemApi } from './preload/appSystem';
import { artifactsApi } from './preload/artifacts';
import { automationApi } from './preload/automation';
import { codingAgentApi } from './preload/codingAgent';
import { coworkApi } from './preload/cowork';
import { imApi } from './preload/im';
import { localInferenceApi } from './preload/localInference';
import { memoryApi } from './preload/memory';
import { providersApi } from './preload/providers';
import { skillsAndMcpApi } from './preload/skillsAndMcp';

const { appUpdate, ...appSystem } = appSystemApi;

// ─── Exposed API ────────────────────────────────────────────────────────────
contextBridge.exposeInMainWorld('electron', {
  platform: process.platform,
  arch: process.arch,

  ...appSystem,
  ...(!isDefenseEdition() && { appUpdate }),
  ...skillsAndMcpApi,
  ...artifactsApi,
  ...localInferenceApi,
  ...providersApi,
  ...coworkApi,
  ...codingAgentApi,
  ...imApi,
  ...memoryApi,
  ...automationApi,
});
