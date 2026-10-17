/**
 * Application startup sequence: enterprise extension, store, runtimes,
 * IPC bootstrap, main window creation and post-start wiring.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import { pathToFileURL } from 'url';

import { app, BrowserWindow, net, powerMonitor, protocol } from 'electron';

import { isDev } from './appEnv';
import { ZHIYUAN_ENTERPRISE_RENDERER_SCHEME } from '../enterpriseExtension/rendererBridge';
import { rt } from './runtimeState';
import {
  AppConfigSettings,
  applyProxyPreference,
  getSqliteAutoBackupEnabledFromConfig,
  getUseSystemProxyFromConfig,
} from './appConfigSettings';
import { updateTitleBarOverlay } from './windowManagement';
import { setLanguage } from '../i18n';
import { ensureWindowsTaskbarBrand } from './windowBranding';
import { createMainWindow } from './mainWindow';
import { setContentSecurityPolicy } from './windowSecurity';
import {
  getStore,
  getMcpStore,
  initStore,
  getLlamaCppManager,
  getOllamaManager,
  checkForAppUpdate,
  startAppUpdatePolling,
  setPreventSleepBlockerEnabled,
} from './runtimeServices';
import { getCoworkStore } from './runtimeServices';
import { startCcConnectBridge, reconcileCcConnectChannelSidecars } from './ccConnectRuntime';
import { refreshEndpointsTestMode } from '../libs/endpoints';
import {
  getEngramManager,
  getProjectMemoryService,
  getPiRuntimeAdapter,
  getWorkbenchTaskService,
} from './sessionServices';
import { getCodingRoomService } from './codingRoomRuntime';
import { getCoworkImageRoot } from './coworkSessionImages';
import { bindPiWorkbenchRuntimeForwarder } from './piUiForwarder';
import { initMcpServers } from './mcpBootstrap';
import { resolveDefaultAgentModelRef } from './messageTriage';
import { handleDeepLink } from './communityAuth';
import { getCronJobService } from '../ipcHandlers/scheduledTask';
import { aisphereService, startAISphereGateway } from '../extensions/aisphere';
import { getBranding } from '../../shared/branding';
import { DB_FILENAME } from '../appConstants';
import { startSqliteDiagnostics } from '../sqliteDiagnostics';
import { SqliteBackupManager } from '../libs/sqliteBackup/sqliteBackupManager';
import { isAllowedLocalfilePath } from '../localfilePathValidation';
import { registerDevNetworkProtocol } from '../devNetworkLog';
import { ActivityService } from '../activity/activityService';
import { ActivitySource, ActivityStatus } from '../../shared/activity/constants';
import { registerWorkbenchTaskIpcHandlers } from '../workbenchTask/ipc';
import { normalizeSingleExpertIds } from '../../shared/cowork/sessionExperts';
import { observePreparedRun } from '../workbenchTask/preparedRunFailure';
import { CoworkPermissionMode } from '../../shared/cowork/constants';
import {
  WorkbenchApprovalMode,
  type WorkbenchRun,
  type WorkbenchTask,
} from '../../shared/workbenchTask';
import { registerTodoIpcHandlers } from '../todo/ipc';
import { TodoReminderScheduler } from '../todo/reminderScheduler';
import { registerCodingAgentIpcHandlers } from '../ipcHandlers/codingAgent';
import { registerMemoryIpcHandlers } from '../memory/ipc';
import { resolveMemorySessionTitles } from '../memory/sessionTitleResolver';
import { registerLlamaCppIpcHandlers } from '../ipcHandlers/llamacpp';
import { registerTriageIpcHandlers } from '../ipcHandlers/triage';
import { registerOllamaIpcHandlers } from '../ipcHandlers/ollama';
import { registerMarketplaceIpcHandlers } from '../ipcHandlers/marketplace';
import { initCopilotTokenManager } from '../libs/copilotTokenManager';
import { setCopilotTokenState } from '../libs/copilotTokenManager';
import { resolveEnterpriseConfigPath, syncEnterpriseConfig } from '../libs/enterpriseConfigSync';
import { CoworkExecutionMode } from '../../shared/cowork/constants';
import { setTriageClassifierDeps } from '../libs/agentEngine/piClassifierTriage';
import { ZhiyuanEnterpriseSkillBridge } from '../enterpriseExtension/skillBridge';
import { zhiyuanEnterpriseRendererBridge } from '../enterpriseExtension/rendererBridge';
import { allowEnterpriseRendererOpaqueOrigin } from '../enterpriseExtension/rendererProtocol';
import { initializeZhiyuanEnterpriseExtension } from '../enterpriseExtension/host';
import { zhiyuanEnterpriseSessionBridge } from '../enterpriseExtension/sessionBridge';
import { zhiyuanManagedProviderBridge } from '../enterpriseExtension/managedProviderBridge';
import { SqliteScheduledTaskStore } from '../../scheduledTask/sqliteScheduledTaskStore';
import { getSkillManager } from './runtimeServices';
import { getSkillsRoot } from '../libs/coworkUtil';
import { appendPythonRuntimeToEnv, ensurePythonRuntimeReady } from '../libs/pythonRuntime';
import { getSkillServiceManager } from '../skillServices';
import { StartupProfiler } from '../startupProfiler';
import { setAutoLaunchEnabled } from '../autoLaunchManager';
import { updateTrayMenu } from '../trayManager';
import { APP_UPDATE_POLL_INTERVAL_MS } from '../../shared/appUpdate/constants';

export const initApp = async (): Promise<void> => {
  // Original bootstrap body, kept as one unit; invoked below so exported
  // initApp() actually runs the startup sequence.
  const runInitApp = async (): Promise<void> => {
    const profiler = new StartupProfiler();

    profiler.mark('app.whenReady');
    console.log('[Main] initApp: waiting for app.whenReady()');
    await app.whenReady();
    profiler.measure('app.whenReady');
    console.log('[Main] initApp: app is ready');
    // 开发态写入带知远 .ico 的开始菜单快捷方式，任务栏按 AUMID 取图标。
    ensureWindowsTaskbarBrand();

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
    if (enterpriseExtension.extensionId) {
      console.log(
        `[EnterpriseExtension] Initialized ${enterpriseExtension.extensionId} with API version 1.`,
      );
    }

    void getEngramManager()
      .start()
      .catch(error => console.warn('[MemoryRuntime] Failed to start local memory service:', error));

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
        const url = new URL(request.url);
        let targetPath = decodeURIComponent(url.pathname);
        if (process.platform === 'win32' && /^\/[a-zA-Z]:/.test(targetPath)) {
          targetPath = targetPath.slice(1);
        }
        const resolvedPath = path.resolve(targetPath);
        const allowedImageRoot = getCoworkImageRoot();

        if (!isAllowedLocalfilePath(resolvedPath, allowedImageRoot)) {
          console.warn('[LocalfileProtocol] Blocked unauthorized file access attempt:', targetPath);
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
    // 2026/09/17 lixiang  仅开发态挂 Network 镜像，避免生产 clone 响应体
    if (isDev) {
      registerDevNetworkProtocol();
    }

    profiler.mark('initStore');
    console.log('[Main] initApp: starting initStore()');
    rt.store = await initStore();
    startSqliteDiagnostics({
      db: rt.store.getDatabase(),
      dbPath: path.join(app.getPath('userData'), DB_FILENAME),
    });
    if (getBranding().features.enableAISphere) {
      try {
        const aisphereGateway = await startAISphereGateway();
        await aisphereService.initialize(rt.store, aisphereGateway.baseUrl);
        aisphereService.busy = () => Boolean(rt.piRuntimeAdapter?.hasRunningSessions());
        app.once('before-quit', () => {
          void aisphereGateway.close();
        });
        console.log('[Main] initApp: AISphere gateway initialized at', aisphereGateway.baseUrl);
      } catch (error) {
        console.error('[Main] initApp: Failed to initialize AISphere gateway:', error);
      }
    }
    profiler.measure('initStore');
    console.log('[Main] initApp: store initialized');
    void getEngramManager()
      .start()
      .then(connection => {
        if (!connection) return;
        return getProjectMemoryService().drainOutbox();
      })
      .catch(error => console.warn('[ProjectMemory] Failed to drain pending operations:', error));
    refreshEndpointsTestMode(rt.store);
    rt.sqliteBackupManager = new SqliteBackupManager(app.getPath('userData'));
    await startCcConnectBridge().catch(error =>
      console.error('[cc-connect] Failed to start local bridge:', error),
    );
    await reconcileCcConnectChannelSidecars().catch(error => {
      console.error('[ChannelRuntime] Failed to start unified runtime:', error);
    });
    const startSqliteBackupLoop = async (): Promise<void> => {
      if (!rt.sqliteBackupManager) return;
      await rt.sqliteBackupManager.startPeriodicBackupLoop(() => getStore().getDatabase());
    };

    const stopSqliteBackupLoop = (): void => {
      rt.sqliteBackupManager?.stopPeriodicBackupLoop();
    };

    if (getSqliteAutoBackupEnabledFromConfig(getStore().get<AppConfigSettings>('app_config'))) {
      await startSqliteBackupLoop().catch(error => {
        console.error('[SqliteBackup] Failed to start periodic backup loop:', error);
      });
    }

    // Defensive recovery: app may be force-closed during execution and leave
    // stale running flags in DB. Normalize them on startup.
    const resetCount = getCoworkStore().resetRunningSessions();
    console.log('[Main] initApp: resetRunningSessions done, count:', resetCount);
    if (resetCount > 0) {
      console.log(`[Main] Reset ${resetCount} stuck cowork session(s) from running -> idle`);
    }
    rt.activityService ??= new ActivityService(getStore().getDatabase());
    const recoveredActivityRuns = rt.activityService.recoverInterruptedRuns();
    if (recoveredActivityRuns > 0) {
      console.warn(
        `[Activity] marked ${recoveredActivityRuns} interrupted activity run(s) as failed`,
      );
    }
    const prunedActivityRuns = rt.activityService.pruneExpired();
    if (prunedActivityRuns > 0) {
      console.log(`[Activity] removed ${prunedActivityRuns} expired activity run(s)`);
    }
    const recoveredScheduledRuns = new SqliteScheduledTaskStore(
      getStore().getDatabase(),
    ).recoverInterruptedRuns(run => {
      rt.activityService?.upsertBestEffort({
        id: run.id,
        source: ActivitySource.ScheduledTask,
        status: ActivityStatus.Failed,
        startedAt: Date.parse(run.startedAt),
        updatedAt: Date.parse(run.finishedAt ?? run.startedAt),
        errorMessage: run.error ?? undefined,
      });
    });
    if (recoveredScheduledRuns > 0) {
      console.warn(`[Scheduler] marked ${recoveredScheduledRuns} interrupted Run(s) as failed`);
    }
    const recoveredWorkbenchTasks = getWorkbenchTaskService().recoverInterruptedState();
    if (recoveredWorkbenchTasks > 0) {
      console.log(
        `[WorkbenchTask] marked ${recoveredWorkbenchTasks} interrupted task(s) for explicit recovery`,
      );
    }
    registerWorkbenchTaskIpcHandlers({
      getService: getWorkbenchTaskService,
      startPreparedRun: async (task: WorkbenchTask, run: WorkbenchRun, resumeInput) => {
        const session = getCoworkStore().getSession(task.sessionId);
        if (!session) throw new Error('Cowork session not found.');
        const config = getCoworkStore().getConfig();
        const amendment = resumeInput?.amendment?.trim() ?? '';
        const prompt =
          amendment || 'Continue the current task from its persisted state and verify the result.';
        // 2026/09/17 lixiang  resume 不等待整段跑完（对齐 Continue IPC），否则底部无法切到停止
        observePreparedRun(
          () =>
            getPiRuntimeAdapter().continueSession(session.id, prompt, {
              systemPrompt: session.systemPrompt,
              skillIds: resumeInput?.skillIds ?? session.activeSkillIds,
              sessionMode: session.mode,
              workspaceRoot: session.cwd,
              agentId: session.agentId,
              expertIds:
                resumeInput?.expertIds === undefined
                  ? session.experts.slice(0, 1).map(expert => expert.expertId)
                  : normalizeSingleExpertIds(resumeInput.expertIds),
              modelOverride: session.modelOverride,
              approvalMode:
                config.permissionMode === CoworkPermissionMode.AllowAll
                  ? WorkbenchApprovalMode.AllowAll
                  : WorkbenchApprovalMode.Ask,
              goalMode: resumeInput?.goalMode,
              imageAttachments: resumeInput?.imageAttachments,
              fileAttachments: resumeInput?.fileAttachments,
              _workbenchRunId: run.id,
              _skipUserMessage: !amendment,
            }),
          task,
          run,
          { service: getWorkbenchTaskService(), runtime: getPiRuntimeAdapter() },
        );
      },
    });
    rt.todoReminderScheduler = new TodoReminderScheduler(getStore().getDatabase());
    rt.todoReminderScheduler.start();
    registerTodoIpcHandlers(() => getStore().getDatabase(), {
      onMutation: () => rt.todoReminderScheduler?.refresh(),
    });
    registerCodingAgentIpcHandlers(getCodingRoomService);
    const recoveredCodingLanes = getCodingRoomService().recoverInterruptedState();
    if (recoveredCodingLanes > 0) {
      console.warn(
        `[CodingAgent] recovered ${recoveredCodingLanes} interrupted lane(s) after restart`,
      );
    }
    void getCodingRoomService()
      .registry.discoverExternalAgents()
      .catch(error => {
        console.warn('[CodingAgent] External ACP discovery failed:', error);
      });
    registerMemoryIpcHandlers({
      getService: getProjectMemoryService,
      resolveSessionTitles: sessionIds =>
        resolveMemorySessionTitles(getStore().getDatabase(), sessionIds),
    });
    getStore().onDidChange<AppConfigSettings>('app_config', (next, previous) => {
      // Provider/model edits are the user's explicit statement about what the
      // models can do: drop runtime image-capability observations so a corrected
      // endpoint or a re-enabled switch takes effect without a restart.
      const modelConfigSection = (value: AppConfigSettings | undefined): string => {
        const record = value as Record<string, unknown> | undefined;
        return JSON.stringify([
          record?.providers ?? null,
          record?.api ?? null,
          record?.model ?? null,
        ]);
      };
      if (modelConfigSection(next) !== modelConfigSection(previous)) {
        void getPiRuntimeAdapter().resetImageInputCapabilities();
      }
    });
    const localInferenceManager = getLlamaCppManager();
    localInferenceManager.initializeModelsDir();
    rt.llamaCppModelDaemonController = registerLlamaCppIpcHandlers(localInferenceManager, {
      getStore,
      onModelBindingsChanged: async (url, models) => {
        rt.managedMagpieBindings?.setGpuSnapshot(url, models);
        if (rt.magpieManager?.status().state === 'running')
          await rt.managedMagpieBindings?.synchronize();
      },
    });
    // Warm the short-lived backend cache before the runtime settings dialog is opened.
    void localInferenceManager.listBackends();
    registerTriageIpcHandlers({ getStore });
    registerOllamaIpcHandlers(getOllamaManager(), {
      getStore,
      onModelBindingsChanged: async snapshot => {
        rt.managedMagpieBindings?.setOllamaSnapshot(snapshot);
        if (rt.magpieManager?.status().state === 'running')
          await rt.managedMagpieBindings?.synchronize();
      },
    });
    registerMarketplaceIpcHandlers({
      getModelsDir: () => getLlamaCppManager().getModelsDir(),
      userDataPath: app.getPath('userData'),
    });
    // Initialize Copilot token manager and restore token state if available
    initCopilotTokenManager(getStore);
    const storedGithubToken = getStore().get('github_copilot_github_token') as string | undefined;
    if (storedGithubToken) {
      import('../libs/githubCopilotAuth.js')
        .then(({ getCopilotToken }) =>
          getCopilotToken(storedGithubToken).then(({ token, expiresAt, baseUrl }) => {
            setCopilotTokenState({
              copilotToken: token,
              baseUrl,
              expiresAt,
              githubToken: storedGithubToken,
            });
            console.log('[Main] restored Copilot token state from stored GitHub token');
          }),
        )
        .catch(err => {
          console.warn('[Main] failed to restore Copilot token on startup:', err);
        });
    }

    // Enterprise config sync must run before agent services initialize.
    profiler.mark('enterpriseConfigSync');
    // so enterprise data is in SQLite when the config is generated.
    const enterpriseConfigPath = resolveEnterpriseConfigPath();
    if (enterpriseConfigPath) {
      try {
        const mcpStoreInstance = getMcpStore();
        syncEnterpriseConfig(
          enterpriseConfigPath,
          rt.store,
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
      const hadEnterprise = rt.store.get('enterprise_config');
      if (hadEnterprise) {
        rt.store.delete('enterprise_config');
        // Restore the default execution mode after removing enterprise configuration.
        const cs = getCoworkStore();
        cs.setConfig({ executionMode: CoworkExecutionMode.Local });
        console.log(
          '[Enterprise] config package removed, cleared enterprise mode and reset executionMode',
        );
      }
    }
    profiler.measure('enterpriseConfigSync');

    // Start MCP servers early so Pi sessions have access to MCP tools.
    // initMcpServers is concurrency-safe: it deduplicates via a promise lock
    // and skips startServers() if the McpServerManager is already running.
    const mcpTools = await initMcpServers();
    console.log(`[Main] initApp: MCP init done, ${mcpTools.length} tools available`);

    bindPiWorkbenchRuntimeForwarder();

    // Wire pi's classifier API for message triage; failures disable the
    // classifier path (rules still classify).
    void (async () => {
      try {
        const [codingAgent, lazyApi] = await Promise.all([
          import('@earendil-works/pi-coding-agent'),
          import('@earendil-works/pi-ai/api/llama-cpp-classify.lazy'),
        ]);
        setTriageClassifierDeps({
          ModelRuntime: codingAgent.ModelRuntime as never,
          llamaCppClassifyApi: lazyApi.llamaCppClassifyApi as never,
        });
      } catch (error) {
        console.warn('[Triage] pi classifier API unavailable:', error);
        setTriageClassifierDeps(null);
      }
    })();

    const defaultAgentModelRef = resolveDefaultAgentModelRef();
    const backfilledAgentModels = getCoworkStore().backfillEmptyAgentModels(defaultAgentModelRef);
    if (backfilledAgentModels > 0) {
      console.log(`[Main] backfilled ${backfilledAgentModels} empty agent model binding(s)`);
    }

    profiler.mark('applyProxyPreference');
    const appConfig = getStore().get<AppConfigSettings>('app_config');
    await applyProxyPreference(getUseSystemProxyFromConfig(appConfig));
    profiler.measure('applyProxyPreference');
    if (getStore().get<boolean>('magpie_service_enabled') === true) {
      await rt.magpieManager?.ensureRunning().catch(error => {
        console.warn('[Magpie] Previously enabled model service could not start:', error);
      });
    }

    try {
      getCronJobService().startPolling();
    } catch (error) {
      console.warn('[Main] Canonical scheduler not available after startup:', error);
    }

    // ── Step 1: Show window ASAP ──────────────────────────────────────
    // CSP + createWindow moved before skill initialisation so the user
    // sees the loading UI within ~1-2 s instead of waiting for the full
    // skill bootstrap (~6-8 s previously).
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

    // Parallelise independent skill sub-tasks (Step 4).
    await Promise.all([
      // Group A: file-system skill operations (sync, must run in order)
      (async () => {
        profiler.mark('syncBundledSkills');
        try {
          manager.syncBundledSkillsToUserData();
          console.log('[Main] initApp: syncBundledSkillsToUserData done');
        } catch (error) {
          console.error('[Main] initApp: syncBundledSkillsToUserData failed:', error);
        }
        profiler.measure('syncBundledSkills');

        try {
          manager.recoverInterruptedUpgrades();
          console.log('[Main] initApp: recoverInterruptedUpgrades done');
        } catch (error) {
          console.error('[Main] initApp: recoverInterruptedUpgrades failed:', error);
        }

        try {
          manager.startWatching();
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

    // Skill services (web-search bridge) — fire-and-forget (Step 2).
    // No IPC handler or downstream init depends on this completing. The
    // memory-leak scenario intentionally omits optional services so a fresh
    // isolated profile cannot block the Electron first-window check while
    // synchronously repairing web-search dependencies.
    if (process.env.ZHIYUAN_MEMORY_LEAK_TEST === '1') {
      console.log('[Main] initApp: skipping optional skill services for memory leak test');
    } else {
      try {
        const skillServices = getSkillServiceManager();
        console.log('[Main] initApp: getSkillServiceManager done');
        const t0 = performance.now();
        void skillServices
          .startAll()
          .then(() => {
            console.log(
              `[Main] initApp: skill services started (background, ${(performance.now() - t0).toFixed(0)}ms)`,
            );
          })
          .catch(error => {
            console.error('[Main] initApp: skill services failed:', error);
          });
      } catch (error) {
        console.error('[Main] initApp: skill services init failed:', error);
      }
    }
    profiler.measure('skillManager');

    console.log(profiler.summary());

    // Windows/Linux cold start: parse deep link from process.argv
    // Always buffer since renderer is not ready yet after createWindow()
    const coldStartDeepLink = process.argv.find(arg => arg.startsWith('zhiyuan://'));
    if (coldStartDeepLink) {
      handleDeepLink(coldStartDeepLink);
    }

    powerMonitor.on('resume', () => {
      if (Date.now() - rt.lastSuccessfulAppUpdateCheckAt >= APP_UPDATE_POLL_INTERVAL_MS) {
        checkForAppUpdate();
      }
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
      updateTitleBarOverlay();
      // 仅在语言变更时刷新托盘菜单文本
      const currentLanguage = newConfig?.language;
      if (currentLanguage !== lastLanguage) {
        lastLanguage = currentLanguage;
        setLanguage(currentLanguage === 'en' ? 'en' : 'zh');
        updateTrayMenu(() => rt.mainWindow);
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
      if (rt.mainWindow && !rt.mainWindow.isDestroyed()) {
        if (!rt.mainWindow.isVisible()) rt.mainWindow.show();
        if (!rt.mainWindow.isFocused()) rt.mainWindow.focus();
        return;
      }
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  };

  await runInitApp();
};
