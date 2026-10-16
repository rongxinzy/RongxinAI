import { BrowserWindow, ipcMain, session, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import { MagpieIpc, type MagpieModelSelection } from '../../shared/magpie/types';
import type { MagpieManager } from './manager';
import type { MagpieModelService } from './modelService';
import { mayEditProviderFromManagement } from './managementPolicy';
import { MagpieOAuthGate } from './oauthPolicy';
/** The app supplies its existing trusted-main-frame predicate. No arbitrary URL/HTTP IPC. */
export function registerMagpieIpc(
  manager: MagpieManager,
  trusted: (event: Electron.IpcMainInvokeEvent) => boolean,
  models?: MagpieModelService,
): () => Promise<void> {
  let window: BrowserWindow | undefined;
  const handle = (channel: string, handler: (...args: any[]) => unknown) => {
    ipcMain.handle(channel, (event, ...args) => {
      if (!trusted(event)) throw new Error('Untrusted model management request');
      return handler(...args);
    });
  };
  handle(MagpieIpc.catalog, () => {
    if (!models) throw new Error('Model catalog is not initialized');
    return models.catalog();
  });
  handle(MagpieIpc.selectDefault, (id: string) => {
    if (!models) throw new Error('Model catalog is not initialized');
    return models.selectDefault(id);
  });
  handle(MagpieIpc.setSubscriptionAccounts, (enabled: boolean) => {
    window?.close();
    return manager.setSubscriptionAccounts(enabled);
  });
  handle(MagpieIpc.status, () => manager.status());
  handle(MagpieIpc.start, () => manager.start());
  handle(MagpieIpc.stop, () => {
    window?.close();
    return manager.stop();
  });
  handle(MagpieIpc.models, () => manager.models());
  handle(MagpieIpc.agents, () => manager.agents());
  handle(MagpieIpc.setModel, (selection: MagpieModelSelection) => manager.setModel(selection));
  handle(MagpieIpc.openManagement, async () => {
    if (window && !window.isDestroyed()) {
      window.show();
      window.focus();
      return;
    }
    const connection = manager.managementConnection();
    const isolatedSession = session.fromPartition(`magpie-${randomUUID()}`);
    isolatedSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
      callback(false),
    );
    isolatedSession.setPermissionCheckHandler(() => false);
    const oauth = new MagpieOAuthGate(id => manager.signInStatus(id));
    // This observer only handles the pinned, authenticated loopback management session.
    // It never accepts an application renderer URL or exposes upstream credentials.
    isolatedSession.webRequest.onBeforeRequest(
      { urls: [`${connection.url}/api/*`] },
      (details, callback) => {
        const route = new URL(details.url).pathname;
        const statusMatch = /^\/api\/signin\/([A-Za-z0-9_-]{1,80})$/.exec(route);
        if (details.method === 'GET' && statusMatch) oauth.observe(statusMatch[1]);
        if (details.method !== 'POST') return callback({});
        if (route === '/api/settings/account-discovery') return callback({ cancel: true });
        if (/^\/api\/signin\/[^/]+\/cancel$/.test(route)) oauth.cancel();
        if (!route.startsWith('/api/provider/') && route !== '/api/signin') return callback({});
        const uploads = details.uploadData ?? [];
        let size = 0;
        const chunks: Buffer[] = [];
        for (const upload of uploads) {
          if (!upload.bytes) return callback({ cancel: true });
          size += upload.bytes.byteLength;
          if (size > 64 * 1024) return callback({ cancel: true });
          chunks.push(Buffer.from(upload.bytes));
        }
        const body = Buffer.concat(chunks).toString('utf8');
        if (route === '/api/signin') {
          try {
            const request = JSON.parse(body) as { agent?: unknown; site?: unknown };
            const agent = request.agent;
            return callback({
              cancel:
                !manager.status().subscriptionAccountsEnabled ||
                typeof agent !== 'string' ||
                (agent === 'copilot' &&
                  request.site !== undefined &&
                  request.site !== '' &&
                  request.site !== 'github.com') ||
                !oauth.begin(agent),
            });
          } catch {
            return callback({ cancel: true });
          }
        }
        callback({ cancel: !mayEditProviderFromManagement(body) });
      },
    );
    await isolatedSession.cookies.set({
      url: connection.url,
      name: connection.cookieName,
      value: connection.key,
      httpOnly: true,
      sameSite: 'lax',
    });
    const current = new BrowserWindow({
      width: 1100,
      height: 800,
      title: '模型与 Coding 管理',
      webPreferences: {
        session: isolatedSession,
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
      },
    });
    window = current;
    let opening: string | undefined;
    current.webContents.setWindowOpenHandler(({ url }) => {
      // The upstream page opens immediately, then polls its flow at 800 ms. Wait briefly
      // for that verified flow id; deny stale/canceled/unknown URLs, including help links.
      if (manager.status().subscriptionAccountsEnabled && !opening) {
        opening = url;
        void (async () => {
          try {
            for (let attempt = 0; attempt < 6 && !current.isDestroyed(); attempt++) {
              if (!manager.status().subscriptionAccountsEnabled) return;
              if (await oauth.allowed(url)) {
                if (!current.isDestroyed() && manager.status().subscriptionAccountsEnabled)
                  await shell.openExternal(url);
                return;
              }
              await new Promise(resolve => setTimeout(resolve, 400));
            }
          } catch {
            /* The management page keeps its copy/retry control; never log an auth URL. */
          } finally {
            opening = undefined;
          }
        })();
      }
      return { action: 'deny' };
    });
    current.webContents.on('will-navigate', (event, url) => {
      if (new URL(url).origin !== connection.url) event.preventDefault();
    });
    current.webContents.on('will-redirect', (event, url) => {
      if (new URL(url).origin !== connection.url) event.preventDefault();
    });
    current.on('closed', () => {
      oauth.cancel();
      if (window === current) window = undefined;
      void isolatedSession.clearStorageData();
    });
    await current.loadURL(connection.url);
  });
  return async () => {
    for (const channel of Object.values(MagpieIpc)) ipcMain.removeHandler(channel);
    window?.destroy();
    await manager.shutdown();
  };
}
