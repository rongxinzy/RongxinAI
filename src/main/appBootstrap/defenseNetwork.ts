import type { Session } from 'electron';

/** Local web assets remain available while the Chromium session is disconnected. */
export function restrictDefenseChromiumNetwork(session: Session, devServer?: string): void {
  const developmentOrigins = new Set<string>();
  if (devServer) {
    const url = new URL(devServer);
    developmentOrigins.add(url.origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    developmentOrigins.add(url.origin);
  }
  session.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    ({ url }, respond) => respond({ cancel: !developmentOrigins.has(new URL(url).origin) }),
  );
}
