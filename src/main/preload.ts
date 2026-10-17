import { contextBridge } from 'electron';

import { appSystemApi } from './preload/appSystem';
import { automationApi } from './preload/automation';
import { codingAgentApi } from './preload/codingAgent';
import { coworkApi } from './preload/cowork';
import { imApi } from './preload/im';
import { localInferenceApi } from './preload/localInference';
import { memoryApi } from './preload/memory';
import { providersApi } from './preload/providers';
import { skillsAndMcpApi } from './preload/skillsAndMcp';

// ─── Exposed API ────────────────────────────────────────────────────────────
contextBridge.exposeInMainWorld('electron', {
  platform: process.platform,
  arch: process.arch,

  ...appSystemApi,
  ...skillsAndMcpApi,
  ...localInferenceApi,
  ...providersApi,
  ...coworkApi,
  ...codingAgentApi,
  ...imApi,
  ...memoryApi,
  ...automationApi,
});
