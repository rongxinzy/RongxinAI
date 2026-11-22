/**
 * Main-process entry point.
 *
 * This module is a thin orchestrator: it wires the single-instance lock, then
 * delegates all bootstrap work (IPC registration, runtime setup, window
 * creation, startup sequencing) to the modules under `./appBootstrap/`.
 * The order of the calls below preserves the original bootstrap sequence.
 */
import './libs/anysearchGatewayCredentials';
import { app } from 'electron';

import {
  applyAppIdentity,
  configureRendererSwitches,
  isDev,
  isEnterprise,
} from './appBootstrap/appEnv';
import { bootstrapProcess } from './appBootstrap/processGuards';
import { handleSecondInstanceExit } from './appBootstrap/singleInstance';
import {
  registerCommunityAuthBootstrap,
  registerCommunityAuthIpc,
} from './appBootstrap/communityAuth';
import { registerAppIpc } from './appIpc';
import { registerSkillsIpc } from './skills/ipc';
import { registerWorkspaceIpc } from './appBootstrap/workspaceIpc';
import { setupMagpieRuntime } from './appBootstrap/magpieRuntime';
import { createLocalInferenceRuntime } from './appBootstrap/localInferenceRuntime';
import { registerCoworkQueueIpc } from './coworkIpc/queue';
import { registerCoreIpc } from './appSystemIpc/core';
import { registerManagedProvidersIpc } from './appSystemIpc/managedProviders';
import { registerAppUpdateIpc } from './appUpdateIpc';
import { createCodingRoomRuntime } from './appBootstrap/codingRoomRuntime';
import { registerIntegrationsIpc } from './integrationsIpc';
import { registerMcpIpc } from './mcpIpc';
import { registerProjectIpc } from './projectIpc';
import { registerPermissionsIpc } from './permissionsIpc';
import { registerDialogIpc } from './dialogIpc';
import { registerCoworkSessionIpc } from './coworkIpc/session';
import { registerCoworkSessionAdminIpc } from './coworkIpc/sessionAdmin';
import { registerArtifactIpc } from './artifactLedger/artifactIpc';
import { registerCoworkConfigIpc } from './coworkIpc/config';
import { registerAgentIpc } from './agentIpc';
import { registerScheduledTaskIpc } from '../scheduledTask/ipc';
import {
  getActivityService,
  getCoworkStore,
  getMcpStore,
  getSkillManager,
  getStore,
  getIMStore,
} from './appBootstrap/runtimeServices';
import { forgetCoworkSession } from './appBootstrap/coworkSessionImages';
import { createCoworkSessionDeletion } from './coworkSessionDeletion';
import {
  coworkSessionDependencies,
  getCanonicalScheduledTaskService,
  getPiRuntimeAdapter,
  getProjectMemoryService,
  getWorkbenchTaskService,
  hasRunningPiSessions,
  markPiMcpConfigurationChanged,
} from './appBootstrap/sessionServices';
import { lifecycleRuntime } from './appBootstrap/lifecycleRuntimeState';
import { getAgentManager, setPreventSleepBlockerEnabled } from './appBootstrap/runtimeServices';
import {
  getDefaultProjectBaseDir,
  getUnmanagedWorkspaceBaseDir,
  isInternalWorkspacePath,
} from './appBootstrap/workspacePaths';
import { getDefaultConversationWorkspacePath } from './defaultConversationWorkspace';
import { getAppUpdateCoordinator } from './appBootstrap/runtimeServices';
import {
  getIMGatewayManager,
  getChannelAccountRuntimeStatus,
  hasIMGatewayManager,
  reconcileCcConnectChannelSidecars,
  refreshCcConnectPlatformStatuses,
  setupCcConnectWeixin,
} from './appBootstrap/ccConnectRuntime';
import { showSystemMenu } from './appBootstrap/windowManagement';
import { resolveDefaultAgentModelRef } from './appBootstrap/defaultAgentModel';
import { registerImGatewayIpc } from './imIpc/gateway';
import { registerImInstanceIpc } from './imIpc/instance';
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
  const deleteCoworkSessions = createCoworkSessionDeletion({
    getCoworkStore,
    getProjectMemoryService,
    getIMStore,
    getWorkbenchTaskService,
    forgetSession: forgetCoworkSession,
  });
  registerCommunityAuthBootstrap();
  registerCoreIpc({ getStore });
  const localInference = createLocalInferenceRuntime(getStore);
  const codingRoom = createCodingRoomRuntime();
  const magpie = setupMagpieRuntime(localInference.readModelBindings);
  registerManagedProvidersIpc({
    isMagpieRunning: magpie.isRunning,
    synchronizeManagedCatalog: magpie.synchronizeCatalog,
  });
  registerAppIpc({
    isDev: () => isDev,
    isEnterprise: () => isEnterprise,
    getStore,
    setPreventSleepBlockerEnabled,
    showSystemMenu,
    reconcileCcConnectChannelSidecars,
    getMainWindow: () => lifecycleRuntime.mainWindow,
    hasIMGatewayManager,
  });
  registerCommunityAuthIpc();
  registerSkillsIpc({ getSkillManager, getStore });
  const shutdownMcpAuthorizations = registerMcpIpc({
    getMcpStore,
    getStore,
    onConfigurationChanged: () => {
      markPiMcpConfigurationChanged();
      codingRoom.bumpCommandCatalog();
    },
  });
  registerWorkspaceIpc(workspaceId =>
    deleteCoworkSessions({ workspaceId }, () =>
      getCoworkStore().workspaces.deleteWorkspace(workspaceId),
    ),
  );
  registerProjectIpc({
    getDefaultProjectBaseDir,
    getUnmanagedWorkspaceBaseDir,
    getDefaultConversationWorkspacePath,
  });
  registerCoworkSessionIpc(coworkSessionDependencies);
  registerCoworkQueueIpc({ getPiRuntimeAdapter });
  registerCoworkSessionAdminIpc({
    getCoworkStore,
    getPiRuntimeAdapter,
    getIMStore,
    deleteSessions: ids => deleteCoworkSessions({ ids }),
  });
  registerArtifactIpc();
  registerCoworkConfigIpc({
    getCoworkStore,
    getSkillManager,
    getPiRuntimeAdapter,
  });
  registerAgentIpc({
    getAgentManager,
    getSkillManager,
    deleteAgentWithSessions: agentId =>
      deleteCoworkSessions({ agentId }, () => getAgentManager().deleteAgent(agentId)),
    bumpCodingCommandCatalog: codingRoom.bumpCommandCatalog,
    resolveDefaultAgentModelRef,
  });
  registerScheduledTaskIpc({
    getActivityService,
    getScheduledTaskService: getCanonicalScheduledTaskService,
    getIMStore,
  });
  registerPermissionsIpc();
  registerImGatewayIpc({
    getIMGatewayManager,
    reconcileCcConnectChannelSidecars,
    refreshCcConnectPlatformStatuses,
    setupCcConnectWeixin,
    resolveCcConnectAccountRuntimeStatus: getChannelAccountRuntimeStatus,
  });
  registerImInstanceIpc({
    getIMGatewayManager,
    reconcileCcConnectChannelSidecars,
  });
  registerIntegrationsIpc({
    isInternalWorkspacePath,
    getCoworkStore,
    checkApiConfig: async () =>
      lifecycleRuntime.isQuitting
        ? { hasConfig: false, config: null }
        : magpie.modelService.checkReadiness(),
  });
  registerDialogIpc();
  registerAppUpdateIpc({
    getAppUpdateCoordinator,
    hasRunningSessions: hasRunningPiSessions,
  });
  const startup = initApp(magpie, localInference, codingRoom);
  registerAppLifecycleHandlers(
    shutdownMcpAuthorizations,
    magpie,
    localInference,
    codingRoom.stop,
    startup,
  );

  // 当所有窗口关闭时退出应用
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      recordAppQuitOrigin(AppQuitOrigin.WindowAllClosed);
      app.quit();
    }
  });
}
