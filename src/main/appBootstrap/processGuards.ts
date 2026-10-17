/**
 * Early process bootstrap: user-data path, logger init and crash/pipe guards.
 * Runs before any window exists so renderer/network failures stay observable.
 */
import { app } from 'electron';

import { configureUserDataPath } from './appEnv';
import { rt } from './runtimeState';
import { scheduleReload } from './windowManagement';
import { reloadOnChildProcessGone } from './appEnv';
import { agentResourceDiagnostics } from '../agentResourceDiagnostics';
import { initLogger, log } from '../logger';
import { shouldReloadRendererProcess } from '../rendererProcessRecovery';
import { createUncaughtReporter, installStdioErrorGuards } from '../stdioErrorGuard';

export const bootstrapProcess = (): void => {
  configureUserDataPath();
  initLogger();

  // 配置网络服务
  app.on('ready', () => {
    agentResourceDiagnostics.setElectronMetricsProvider(() => app.getAppMetrics());
    // 配置网络服务重启策略
    app.configureHostResolver({
      enableBuiltInResolver: true,
      secureDnsMode: 'off',
    });
  });

  // 添加错误处理
  app.on('render-process-gone', (_event, webContents, details) => {
    console.error('[RendererProcess] Render process exited:', details);
    agentResourceDiagnostics.logRendererProcessGone(details.reason);
    if (shouldReloadRendererProcess(details.reason, rt.isQuitting)) {
      scheduleReload(`render-process-gone (${details.reason})`, webContents);
    }
  });

  app.on('child-process-gone', (_event, details) => {
    console.error('Child process gone:', details);
    if (reloadOnChildProcessGone && (details.type === 'GPU' || details.type === 'Utility')) {
      scheduleReload(`child-process-gone (${details.type}/${details.reason})`);
    }
  });

  // 终端或父进程先于应用消失时 stdout/stderr 管道会断开，之后的写入以 EPIPE 异步抛错。
  // 先吞掉这类断管道错误，否则它会被升级成未捕获异常，而兜底处理器又通过
  // console.error 写同一个断掉的管道，形成死循环并让进程永远不退。
  installStdioErrorGuards([process.stdout, process.stderr], error => {
    log.error('[Main] stdio write failed:', error);
  });

  // 处理未捕获的异常
  process.on(
    'uncaughtException',
    createUncaughtReporter(error => {
      console.error('Uncaught Exception:', error);
    }),
  );

  process.on(
    'unhandledRejection',
    createUncaughtReporter(error => {
      console.error('Unhandled Rejection:', error);
    }),
  );

  process.on('exit', code => {
    console.log(`[Main] Process exiting with code: ${code}`);
  });
};
