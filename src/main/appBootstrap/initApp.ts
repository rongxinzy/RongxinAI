/**
 * Application startup sequence: enterprise extension, store, runtimes,
 * IPC bootstrap, main window creation and post-start wiring.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import { pathToFileURL } from 'url';

import { app, dialog, net, powerMonitor, protocol } from 'electron';

import { ZHIYUAN_ENTERPRISE_RENDERER_SCHEME } from '../enterpriseExtension/rendererBridge';
import { lifecycleRuntime } from './lifecycleRuntimeState';
import {
  AppConfigSettings,
  applyProxyPreference,
  getSqliteAutoBackupEnabledFromConfig,
  getUseSystemProxyFromConfig,
} from './appConfigSettings';
import { updateTitleBarOverlay } from './windowManagement';
import { setLanguage } from '../i18n';
import { prepareWindowsTaskbarIdentity } from './windowBranding';
import { createMainWindow, focusOrCreateMainWindow } from './mainWindow';
import { setContentSecurityPolicy } from './windowSecurity';
import {
  getStore,
  getArtifactLedger,
  getActivityService,
  getScheduledTaskStore,
  getMcpStore,
  initStore,
  startSqliteBackupLoop,
  stopSqliteBackupLoop,
  checkForAppUpdateOnResume,
  startAppUpdatePolling,
  setPreventSleepBlockerEnabled,
} from './runtimeServices';
import { getCoworkStore } from './runtimeServices';
import {
  getCcConnectDeliveryTransport,
  reconcileCcConnectChannelSidecars,
} from './ccConnectRuntime';
import { refreshEndpointsTestMode } from '../libs/endpoints';
import {
  getCanonicalScheduledTaskService,
  startEngram,
  startMemoryOutbox,
  resumeMemoryOutbox,
  getProjectMemoryService,
  initializeSessionRuntime,
  hasRunningPiSessions,
  getWorkbenchTaskService,
} from './sessionServices';
import type { CodingRoomRuntime } from './codingRoomRuntime';
import { registerShellIpc } from '../shellIpc';
import { CodingRoomRepository } from '../codingAgent/codingRoomRepository';
import { initializeCompanionServices } from './companionTasks';
import { getCoworkImageRoot } from './workspacePaths';
import {
  recoverPendingCoworkStartImages,
  removeAbandonedCoworkImageWrites,
} from '../coworkImageAttachments';
import { bindPiWorkbenchRuntimeForwarder } from './piUiForwarder';
import { ensureBuiltInMcpDefaultsDisabled } from './mcpBootstrap';
import { resolveDefaultAgentModelRef } from './defaultAgentModel';
import { ensureEmbeddedPiAgentDir } from '../libs/agentEngine/piAgentDir';
import { handleDeepLink } from './communityAuth';
import type { MagpieRuntime } from './magpieRuntime';
import type { LocalInferenceRuntime } from './localInferenceRuntime';
import { DB_FILENAME } from '../appConstants';
import { startSqliteDiagnostics } from '../sqliteDiagnostics';
import type { SqliteStore } from '../sqliteStore';
import { isAllowedLocalfilePath, resolveLocalfileRequestPath } from '../localfilePathValidation';
import { registerWorkbenchTaskIpcHandlers } from '../workbenchTask/ipc';
import { registerTodoIpcHandlers } from '../todo/ipc';
import { registerCodingAgentIpcHandlers } from '../ipcHandlers/codingAgent';
import { registerMemoryIpcHandlers } from '../memory/ipc';
import { resolveMemorySessionTitles } from '../memory/sessionTitleResolver';
import { cleanupLegacyCopilotStoredToken } from '../legacyCredentialCleanup';
import { resolveEnterpriseConfigPath, syncEnterpriseConfig } from '../libs/enterpriseConfigSync';
import { CoworkExecutionMode } from '../../shared/cowork/constants';
import { ZhiyuanEnterpriseSkillBridge } from '../enterpriseExtension/skillBridge';
import { zhiyuanEnterpriseRendererBridge } from '../enterpriseExtension/rendererBridge';
import { allowEnterpriseRendererOpaqueOrigin } from '../enterpriseExtension/rendererProtocol';
import { initializeZhiyuanEnterpriseExtension } from '../enterpriseExtension/host';
import { zhiyuanEnterpriseSessionBridge } from '../enterpriseExtension/sessionBridge';
import { zhiyuanManagedProviderBridge } from '../enterpriseExtension/managedProviderBridge';
import { getSkillManager } from './runtimeServices';
import { getSkillsRoot } from '../libs/coworkUtil';
import { appendPythonRuntimeToEnv, ensurePythonRuntimeReady } from '../libs/pythonRuntime';
import { StartupProfiler } from '../startupProfiler';
import { setAutoLaunchEnabled } from '../autoLaunchManager';
import { updateTrayMenu } from '../trayManager';
import { recoverInterruptedWork } from './recoverInterruptedWork';
import {
  migrateLegacyScheduledTasksToCanonical,
  migrateLegacyScheduledTaskRunsToCanonical,
} from '../../scheduledTask/migrate';
import {
  PI_SESSION_GENERATIONS_DIR,
  PI_SESSIONS_ROOT_DIR,
} from '../libs/agentEngine/piSessionStore';
import { recoverSessionDirectoryRemovals } from '../removeSessionDirectory';

export const initApp = async (
  magpie: MagpieRuntime,
  localInference: Pick<LocalInferenceRuntime, 'start'>,
  codingRoomRuntime: Pick<CodingRoomRuntime, 'start'>,
): Promise<void> => {
  // Original bootstrap body, kept as one unit; invoked below so exported
  // initApp() actually runs the startup sequence.
  const runInitApp = async (): Promise<void> => {
    const profiler = new StartupProfiler();

    profiler.mark('app.whenReady');
    console.log('[Main] initApp: waiting for app.whenReady()');
    await app.whenReady();
    if (lifecycleRuntime.isQuitting) return;
    profiler.measure('app.whenReady');
    console.log('[Main] initApp: app is ready');
    const piSessionRoot = path.join(app.getPath('userData'), PI_SESSIONS_ROOT_DIR);
    void Promise.all(
      [
        getCoworkImageRoot(),
        piSessionRoot,
        path.join(piSessionRoot, PI_SESSION_GENERATIONS_DIR),
      ].map(recoverSessionDirectoryRemovals),
    ).catch(error => {
      console.warn('[Cowork] failed to recover deleted session directories:', error);
    });
    await removeAbandonedCoworkImageWrites(getCoworkImageRoot()).catch((error: unknown) => {
      console.warn('[CoworkImages] failed to clean abandoned staged images:', error);
    });
    await ensureEmbeddedPiAgentDir(app.getPath('userData')).catch(error => {
      console.error('[PiRuntime] Failed to prepare embedded Pi agent directory:', error);
    });
    // 清理同一 AUMID 的旧开发态快捷方式，再写入开发态快捷方式；任务栏按
    // 开始菜单解析名称与图标，顺序反了会继续落到 Electron 原子图标。
    await prepareWindowsTaskbarIdentity();
    if (lifecycleRuntime.isQuitting) return;

    protocol.handle(ZHIYUAN_ENTERPRISE_RENDERER_SCHEME, async request => {
      const assetPath = zhiyuanEnterpriseRendererBridge.resolveAsset(request.url);
      if (!assetPath) return new Response(null, { status: 404 });
      const response = await net.fetch(pathToFileURL(assetPath).toString());
      return allowEnterpriseRendererOpaqueOrigin(response);
    });

    const enterpriseExtension = await initializeZhiyuanEnterpriseExtension({
      appVersion: app.getVersion(),
      isPackaged: app.isPackaged,
      platform: process.platform,
      resourcesPath: process.resourcesPath,
      userDataPath: app.getPath('userData'),
      developmentExtensionPath: process.env.ZHIYUAN_ENTERPRISE_EXTENSION_DEV_PATH,
      sessionCapability: zhiyuanEnterpriseSessionBridge,
      managedProviderCapability: zhiyuanManagedProviderBridge,
      createSkillCapability: () =>
        new ZhiyuanEnterpriseSkillBridge({
          userDataPath: app.getPath('userData'),
          refreshSkills: () => getSkillManager().handleWorkingDirectoryChange(),
        }),
      createRendererCapability: extensionDirectory =>
        zhiyuanEnterpriseRendererBridge.createScopedCapability(extensionDirectory),
      createSettingsCapability: extensionDirectory =>
        zhiyuanEnterpriseRendererBridge.createScopedSettingsCapability(extensionDirectory),
    });
    if (lifecycleRuntime.isQuitting) return;
    if (enterpriseExtension.extensionId) {
      console.log(
        `[EnterpriseExtension] Initialized ${enterpriseExtension.extensionId} with API version 1.`,
      );
    }

    const engramReady = startEngram();

    // Note: Calendar permission is checked on-demand when calendar operations are requested
    // We don't trigger permission dialogs at startup to avoid annoying users

    // Ensure default working directory exists
    const defaultProjectDir = path.join(os.homedir(), 'zhiyuan', 'project');
    if (!fs.existsSync(defaultProjectDir)) {
      fs.mkdirSync(defaultProjectDir, { recursive: true });
      console.log('Created default project directory:', defaultProjectDir);
    }
    console.log('[Main] initApp: default project dir ensured');

    // 注册 localfile:// 自定义协议，用于安全加载本地图片
    protocol.handle('localfile', request => {
      try {
        const resolvedPath = resolveLocalfileRequestPath(request.url);
        const allowedImageRoot = getCoworkImageRoot();

        if (!isAllowedLocalfilePath(resolvedPath, allowedImageRoot)) {
          console.warn(
            '[LocalfileProtocol] Blocked unauthorized file access attempt:',
            resolvedPath,
          );
          return new Response('Forbidden', { status: 403 });
        }

        if (!fs.existsSync(resolvedPath)) {
          return new Response('Not Found', { status: 404 });
        }

        return net.fetch(pathToFileURL(resolvedPath).toString());
      } catch (error) {
        console.error('[LocalfileProtocol] Failed to handle localfile request:', error);
        return new Response('Bad Request', { status: 400 });
      }
    });

    profiler.mark('initStore');
    console.log('[Main] initApp: starting initStore()');
    let store: SqliteStore;
    let codingRepository: CodingRoomRepository;
    try {
      store = await initStore();
      if (lifecycleRuntime.isQuitting) return;
      const db = store.getDatabase();
      codingRepository = new CodingRoomRepository(db, getArtifactLedger());
      const scheduledTaskStore = getScheduledTaskStore();
      const migration = {
        db,
        getKv: (key: string) => store.get(key),
        setKv: (key: string, value: string) => store.set(key, value),
        store: scheduledTaskStore,
      };
      await migrateLegacyScheduledTasksToCanonical(migration).catch(error => {
        console.warn('[Scheduler] Failed to import scheduled tasks:', error);
      });
      if (lifecycleRuntime.isQuitting) return;
      await migrateLegacyScheduledTaskRunsToCanonical(migration).catch(error => {
        console.warn('[Scheduler] Failed to import scheduled task runs:', error);
      });
      if (lifecycleRuntime.isQuitting) return;
      const { runs, companionReplies, scheduledRuns, activityRuns, prunedActivity, codingLanes } =
        recoverInterruptedWork(
          db,
          getWorkbenchTaskService(),
          scheduledTaskStore,
          getActivityService(),
          codingRepository,
          getCoworkStore().messages,
        );
      if (runs || companionReplies || scheduledRuns || activityRuns) {
        console.log(
          `[Main] Recovered ${runs} workbench runs, ${companionReplies} companion replies, ${scheduledRuns} scheduled runs and ${activityRuns} remaining activity entries.`,
        );
      }
      if (prunedActivity) {
        console.log(`[Activity] Removed ${prunedActivity} expired activity runs.`);
      }
      if (codingLanes > 0) {
        console.warn(`[CodingAgent] Recovered ${codingLanes} interrupted lane(s) after restart.`);
      }
    } catch (error) {
      if (lifecycleRuntime.isQuitting) return;
      // Schema migrations are transactional and rethrow instead of silently
      // skipping; without a store the app cannot run, so say so and exit
      // instead of leaving a process with no window.
      const detail = error instanceof Error ? error.message : String(error);
      dialog.showErrorBox(
        '知远无法启动 / 知远 failed to start',
        `本地数据库初始化失败。\nLocal database initialization failed.\n\n${detail}`,
      );
      throw error;
    }
    if (lifecycleRuntime.isQuitting) return;
    await recoverPendingCoworkStartImages(getCoworkImageRoot(), getCoworkStore()).catch(
      (error: unknown) => {
        console.warn('[CoworkImages] failed to recover pending session starts:', error);
      },
    );
    if (lifecycleRuntime.isQuitting) return;
    startSqliteDiagnostics({
      db: store.getDatabase(),
      dbPath: path.join(app.getPath('userData'), DB_FILENAME),
    });
    await magpie.startManagedGateway(
      store,
      hasRunningPiSessions,
      Boolean(enterpriseExtension.extensionId),
    );
    if (lifecycleRuntime.isQuitting) return;
    profiler.measure('initStore');
    console.log('[Main] initApp: store initialized');
    startMemoryOutbox(engramReady);
    refreshEndpointsTestMode(store);
    if (getSqliteAutoBackupEnabledFromConfig(getStore().get<AppConfigSettings>('app_config'))) {
      void startSqliteBackupLoop().catch(error => {
        console.error('[SqliteBackup] Failed to start periodic backup loop:', error);
      });
    }
    if (lifecycleRuntime.isQuitting) return;

    registerWorkbenchTaskIpcHandlers({
      getService: getWorkbenchTaskService,
      getMainWindow: () => lifecycleRuntime.mainWindow,
    });
    registerTodoIpcHandlers(store.getDatabase());
    registerMemoryIpcHandlers({
      getService: getProjectMemoryService,
      resolveSessionTitles: sessionIds =>
        resolveMemorySessionTitles(getStore().getDatabase(), sessionIds),
    });
    localInference.start(magpie);
    // Remove the stored GitHub OAuth token from the retired in-app Copilot
    // device-flow sign-in; subscription sign-in now goes through the model gateway.
    cleanupLegacyCopilotStoredToken(getStore());

    // Enterprise config sync must run before agent services initialize.
    profiler.mark('enterpriseConfigSync');
    // so enterprise data is in SQLite when the config is generated.
    const enterpriseConfigPath = await resolveEnterpriseConfigPath();
    if (lifecycleRuntime.isQuitting) return;
    if (enterpriseConfigPath) {
      try {
        const mcpStoreInstance = getMcpStore();
        await syncEnterpriseConfig(
          enterpriseConfigPath,
          store,
          server => {
            const existing = mcpStoreInstance.listServers().find(s => s.name === server.name);
            if (existing) {
              mcpStoreInstance.updateServer(existing.id, {
                name: server.name,
                description: server.description,
                transportType: server.transportType as 'stdio' | 'sse' | 'http',
                command: server.command,
                args: server.args,
                env: server.env,
              });
            } else {
              mcpStoreInstance.createServer({
                name: server.name,
                description: server.description,
                transportType: server.transportType as 'stdio' | 'sse' | 'http',
                command: server.command,
                args: server.args,
                env: server.env,
              });
            }
          },
          () => {
            // Clear all MCP servers (for overwrite mode)
            for (const s of mcpStoreInstance.listServers()) {
              mcpStoreInstance.deleteServer(s.id);
            }
          },
          () => {
            const cs = getCoworkStore();
            return cs.getConfig().workingDirectory;
          },
        );
      } catch (error) {
        console.error('[Enterprise] config sync failed:', error);
      }
    } else {
      // No enterprise config package found — clear any previously stored config
      // so the app exits enterprise mode after the package is removed.
      const hadEnterprise = store.get('enterprise_config');
      if (hadEnterprise) {
        store.delete('enterprise_config');
        // Restore the default execution mode after removing enterprise configuration.
        const cs = getCoworkStore();
        cs.setConfig({ executionMode: CoworkExecutionMode.Local });
        console.log(
          '[Enterprise] config package removed, cleared enterprise mode and reset executionMode',
        );
      }
    }
    profiler.measure('enterpriseConfigSync');
    if (lifecycleRuntime.isQuitting) return;

    try {
      ensureBuiltInMcpDefaultsDisabled();
    } catch (error) {
      console.error('[McpInit] Failed to apply MCP defaults:', error);
    }

    const channelDelivery = getCcConnectDeliveryTransport();
    const piRuntime = initializeSessionRuntime(magpie.modelService, channelDelivery);
    const codingRoom = codingRoomRuntime.start(magpie.modelService, piRuntime, codingRepository);
    initializeCompanionServices(magpie.modelService, piRuntime);
    registerCodingAgentIpcHandlers(
      () => codingRoom,
      () => lifecycleRuntime.mainWindow,
    );
    registerShellIpc({
      getCoworkStore,
      getCodingWorkspaceRoots: () =>
        codingRoom
          .listWorkspaces()
          .flatMap(workspace => [
            workspace.primaryRoot,
            ...workspace.sources.map(source => source.path),
          ]),
    });
    bindPiWorkbenchRuntimeForwarder(piRuntime, () => lifecycleRuntime.mainWindow);
    void codingRoom.registry.discoverExternalAgents().catch(error => {
      if (!lifecycleRuntime.isQuitting) {
        console.warn('[CodingAgent] External ACP discovery failed:', error);
      }
    });
    const defaultAgentModelRef = resolveDefaultAgentModelRef();
    const backfilledAgentModels = getCoworkStore().backfillEmptyAgentModels(defaultAgentModelRef);
    if (backfilledAgentModels > 0) {
      console.log(`[Main] backfilled ${backfilledAgentModels} empty agent model binding(s)`);
    }

    profiler.mark('applyProxyPreference');
    const appConfig = getStore().get<AppConfigSettings>('app_config');
    await applyProxyPreference(getUseSystemProxyFromConfig(appConfig));
    if (lifecycleRuntime.isQuitting) return;
    profiler.measure('applyProxyPreference');

    // Create the window before waiting for the gateway and bundled skills.
    setContentSecurityPolicy();

    profiler.mark('createWindow');
    console.log('[Main] initApp: creating window');
    createMainWindow();
    profiler.measure('createWindow');
    console.log('[Main] initApp: window created');
    startAppUpdatePolling();

    // ── Step 2-4: Skill bootstrap (non-blocking) ────────────────────
    console.log('[Main] initApp: starting skill bootstrap');
    profiler.mark('skillManager');
    const manager = getSkillManager();
    console.log('[Main] initApp: getSkillManager done');

    // Inject SKILLS_ROOT into process.env so ALL subprocesses (Pi sessions,
    // shell tools spawned by the agent, skill scripts, etc.) inherit it.
    // Set this globally so Pi sessions and their subprocesses inherit it.
    const skillsRoot = getSkillsRoot().replace(/\\/g, '/');
    process.env.SKILLS_ROOT = skillsRoot;
    process.env.ZHIYUAN_SKILLS_ROOT = skillsRoot;
    console.log('[Main] initApp: SKILLS_ROOT =', skillsRoot);

    // Channel owns its shutdown. Only outbound delivery waits for its connection.
    void channelDelivery.trackStartup(
      reconcileCcConnectChannelSidecars().catch(error => {
        console.error('[ChannelRuntime] Failed to start unified runtime:', error);
      }),
    );
    await Promise.all([
      (async () => {
        await magpie.start();
        if (lifecycleRuntime.isQuitting) return;

        try {
          await getCanonicalScheduledTaskService().armSavedSchedules();
        } catch (error) {
          console.warn('[Scheduler] Failed to arm saved schedules:', error);
        }
      })(),

      // Group A: recover interrupted replacements before syncing the packaged skills.
      (async () => {
        profiler.mark('syncBundledSkills');
        try {
          await manager.prepareBundledSkills();
        } catch (error) {
          console.error('[Main] initApp: bundled skill preparation failed:', error);
        }
        profiler.measure('syncBundledSkills');
        if (lifecycleRuntime.isQuitting) return;

        try {
          manager.startWatching();
          manager.notifySkillsChanged();
          console.log('[Main] initApp: startWatching done');
        } catch (error) {
          console.error('[Main] initApp: startWatching failed:', error);
        }
      })(),

      // Group B: python runtime (independent, async)
      (async () => {
        profiler.mark('pythonRuntime');
        try {
          const runtimeResult = await ensurePythonRuntimeReady();
          if (!runtimeResult.success) {
            console.error('[Main] initApp: ensurePythonRuntimeReady failed:', runtimeResult.error);
          } else {
            console.log('[Main] initApp: ensurePythonRuntimeReady done');
            appendPythonRuntimeToEnv(process.env as Record<string, string | undefined>);
          }
        } catch (error) {
          console.error('[Main] initApp: ensurePythonRuntimeReady threw:', error);
        }
        profiler.measure('pythonRuntime');
      })(),
    ]);
    if (lifecycleRuntime.isQuitting) return;

    profiler.measure('skillManager');

    console.log(profiler.summary());

    // Windows/Linux cold start: parse deep link from process.argv
    // Always buffer since renderer is not ready yet after createWindow()
    const coldStartDeepLink = process.argv.find(arg => arg.startsWith('zhiyuan://'));
    if (coldStartDeepLink) {
      handleDeepLink(coldStartDeepLink);
    }

    let magpieResumeTimer: NodeJS.Timeout | undefined;
    powerMonitor.on('suspend', () => {
      if (magpieResumeTimer) {
        clearTimeout(magpieResumeTimer);
        magpieResumeTimer = undefined;
      }
      magpie.onSuspend();
    });

    powerMonitor.on('resume', () => {
      if (lifecycleRuntime.isQuitting) return;
      resumeMemoryOutbox();
      const recoverMagpie = () => {
        if (lifecycleRuntime.isQuitting) return;
        void magpie.recoverIfNeeded().catch(error => {
          console.warn('[Magpie] Model service recovery after system resume failed:', error);
        });
      };
      if (process.platform === 'win32') {
        if (magpieResumeTimer) clearTimeout(magpieResumeTimer);
        magpieResumeTimer = setTimeout(() => {
          magpieResumeTimer = undefined;
          recoverMagpie();
        }, 500);
      } else {
        recoverMagpie();
      }
      checkForAppUpdateOnResume();
    });

    // 首次启动时默认开启开机自启动（先写标记再设置，避免崩溃后重复设置）
    if (!getStore().get('auto_launch_initialized')) {
      getStore().set('auto_launch_initialized', true);
      getStore().set('auto_launch_enabled', true);
      setAutoLaunchEnabled(true);
    }

    // Restore prevent-sleep setting
    const preventSleepEnabled = getStore().get<boolean>('prevent_sleep_enabled');
    if (preventSleepEnabled) {
      try {
        setPreventSleepBlockerEnabled(true);
      } catch (err) {
        console.error('[Main] Failed to start prevent-sleep blocker:', err);
      }
    }

    let lastLanguage = getStore().get<AppConfigSettings>('app_config')?.language;
    let lastUseSystemProxy = getUseSystemProxyFromConfig(
      getStore().get<AppConfigSettings>('app_config'),
    );
    let lastSqliteAutoBackupEnabled = getSqliteAutoBackupEnabledFromConfig(
      getStore().get<AppConfigSettings>('app_config'),
    );
    getStore().onDidChange<AppConfigSettings>('app_config', (newConfig, oldConfig) => {
      if (lifecycleRuntime.isQuitting) return;
      updateTitleBarOverlay();
      // 仅在语言变更时刷新托盘菜单文本
      const currentLanguage = newConfig?.language;
      if (currentLanguage !== lastLanguage) {
        lastLanguage = currentLanguage;
        setLanguage(currentLanguage === 'en' ? 'en' : 'zh');
        updateTrayMenu(focusOrCreateMainWindow);
      }

      const previousUseSystemProxy = oldConfig
        ? getUseSystemProxyFromConfig(oldConfig)
        : lastUseSystemProxy;
      const currentUseSystemProxy = getUseSystemProxyFromConfig(newConfig);
      if (currentUseSystemProxy !== previousUseSystemProxy) {
        console.log(
          `[Proxy] system proxy preference changed from ${previousUseSystemProxy} to ${currentUseSystemProxy}`,
        );
        void applyProxyPreference(currentUseSystemProxy);
      }
      lastUseSystemProxy = currentUseSystemProxy;

      const previousSqliteAutoBackupEnabled = oldConfig
        ? getSqliteAutoBackupEnabledFromConfig(oldConfig)
        : lastSqliteAutoBackupEnabled;
      const currentSqliteAutoBackupEnabled = getSqliteAutoBackupEnabledFromConfig(newConfig);
      if (currentSqliteAutoBackupEnabled !== previousSqliteAutoBackupEnabled) {
        if (currentSqliteAutoBackupEnabled) {
          void startSqliteBackupLoop().catch(error => {
            console.error('[SqliteBackup] Failed to enable periodic backup loop:', error);
          });
        } else {
          stopSqliteBackupLoop();
        }
      }
      lastSqliteAutoBackupEnabled = currentSqliteAutoBackupEnabled;
    });

    // 在 macOS 上，当点击 dock 图标时显示已有窗口或重新创建
    app.on('activate', () => {
      focusOrCreateMainWindow();
    });

    lifecycleRuntime.bootstrapComplete = true;
  };

  await runInitApp();
};
