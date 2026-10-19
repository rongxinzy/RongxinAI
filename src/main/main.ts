/**
 * Main-process entry point.
 *
 * This module is a thin orchestrator: it wires the single-instance lock, then
 * delegates all bootstrap work (IPC registration, runtime setup, window
 * creation, startup sequencing) to the modules under `./appBootstrap/`.
 * The order of the calls below preserves the original bootstrap sequence.
 */
import { app } from 'electron';

import { applyAppIdentity, configureRendererSwitches } from './appBootstrap/appEnv';
import { bootstrapProcess } from './appBootstrap/processGuards';
import { handleSecondInstanceExit } from './appBootstrap/singleInstance';
import {
  registerCommunityAuthBootstrap,
  registerCommunityAuthIpc,
} from './appBootstrap/communityAuth';
import { registerCoreIpc } from './appBootstrap/coreIpc';
import { registerManagedProvidersIpc } from './appBootstrap/managedProvidersIpc';
import { registerAppIpc } from './appBootstrap/appIpc';
import { registerSkillsIpc } from './skills/ipc';
import { registerMcpIpc } from './appBootstrap/mcpIpc';
import { registerWorkspaceIpc } from './appBootstrap/workspaceIpc';
import { registerProjectIpc } from './appBootstrap/projectIpc';
import { setupMagpieRuntime } from './appBootstrap/magpieRuntime';
import { registerCoworkQueueIpc } from './coworkIpc/queue';
import { registerCoworkSessionIpc } from './coworkIpc/session';
import { registerCoworkSessionAdminIpc } from './coworkIpc/sessionAdmin';
import { registerArtifactIpc } from './artifactLedger/artifactIpc';
import { registerCoworkExportIpc } from './coworkIpc/export';
import { registerCoworkConfigIpc } from './coworkIpc/config';
import { registerAgentIpc } from './appBootstrap/agentIpc';
import { registerScheduledTaskIpc } from '../scheduledTask/ipc';
import {
  getActivityService,
  getCoworkStore,
  getSkillManager,
  getStore,
} from './appBootstrap/runtimeServices';
import { getCoworkImageRoot } from './appBootstrap/coworkSessionImages';
import { getPiRuntimeAdapter } from './appBootstrap/sessionServices';
import { getAgentManager } from './appBootstrap/runtimeServices';
import {
  resolveSessionWorkingDirectory,
  resolveTaskWorkingDirectory,
} from './appBootstrap/workspacePaths';
import {
  getCanonicalScheduledTaskService,
  getIMGatewayManager,
} from './appBootstrap/ccConnectRuntime';
import { registerPermissionsIpc } from './appBootstrap/permissionsIpc';
import { registerImGatewayIpc } from './appBootstrap/imGatewayIpc';
import { registerImInstanceIpc } from './appBootstrap/imInstanceIpc';
import { registerIntegrationsIpc } from './appBootstrap/integrationsIpc';
import { registerDialogIpc } from './appBootstrap/dialogIpc';
import { registerShellIpc } from './appBootstrap/shellIpc';
import { registerAppUpdateIpc } from './appBootstrap/appUpdateIpc';
import { registerAppLifecycleHandlers } from './appBootstrap/appLifecycle';
import { initApp } from './appBootstrap/initApp';
import { AppQuitOrigin, recordAppQuitOrigin } from './appQuitOrigin';

// App identity and privileged schemes must be configured before app ready.
applyAppIdentity();
// User-data path, logger and crash/pipe guards.
bootstrapProcess();
// Chromium renderer switches (software rendering, logging, cache).
configureRendererSwitches();

// 确保应用程序只有一个实例
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // Second instance: focus the first instance or, on Linux, ask before
  // taking over a stale older-version instance, then exit.
  handleSecondInstanceExit();
} else {
  registerCommunityAuthBootstrap();
  registerCoreIpc();
  registerManagedProvidersIpc();
  registerAppIpc();
  registerCommunityAuthIpc();
  registerSkillsIpc({ getSkillManager, getStore });
  registerMcpIpc();
  registerWorkspaceIpc();
  registerProjectIpc();
  setupMagpieRuntime();
  registerCoworkSessionIpc({
    getCoworkImageRoot,
    getAgentManager,
    getCoworkStore,
    getPiRuntimeAdapter,
    resolveSessionWorkingDirectory,
    resolveTaskWorkingDirectory,
  });
  registerCoworkQueueIpc({
    getPiRuntimeAdapter,
    getCoworkStore,
    getCoworkImageRoot,
  });
  registerCoworkSessionAdminIpc({
    getCoworkStore,
    getPiRuntimeAdapter,
    getIMGatewayManager,
  });
  registerArtifactIpc();
  registerCoworkExportIpc({ getPiRuntimeAdapter });
  registerCoworkConfigIpc({
    getCoworkStore,
    getSkillManager,
    getPiRuntimeAdapter,
  });
  registerAgentIpc();
  registerScheduledTaskIpc({
    getActivityService,
    getScheduledTaskService: getCanonicalScheduledTaskService,
    getIMGatewayManager,
  });
  registerPermissionsIpc();
  registerImGatewayIpc();
  registerImInstanceIpc();
  registerIntegrationsIpc();
  registerDialogIpc();
  registerShellIpc();
  registerAppUpdateIpc();
  registerAppLifecycleHandlers();

  // 启动应用
  initApp().catch(console.error);

  // 当所有窗口关闭时退出应用
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      recordAppQuitOrigin(AppQuitOrigin.WindowAllClosed);
      app.quit();
    }
  });
}
