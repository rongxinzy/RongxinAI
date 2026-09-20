import {
  buildDevNetworkBeaconPayload,
  buildDevNetworkBeaconUrl,
  type DevNetworkLogEntry,
} from '../../shared/devNetworkLog';

/**
 * 2026/09/17 lixiang
 * 主进程 HTTP 不会进 Chromium Network；收到日志后发 xr-net:// POST beacon，
 * Response 里带回请求/响应预览，方便在 Network 面板查看。
 */
export function startDevNetworkBeacon(): () => void {
  if (import.meta.env.DEV !== true) return () => {};
  if (!window.electron?.devNetwork?.onEntry) return () => {};

  console.info(
    '[devNetwork] beacon active — click xr-net://log entries → Response 查看接口预览',
  );

  return window.electron.devNetwork.onEntry((entry: DevNetworkLogEntry) => {
    const beaconUrl = buildDevNetworkBeaconUrl(entry);
    void fetch(beaconUrl, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: buildDevNetworkBeaconPayload(entry),
    }).catch(() => {
      // Beacon is best-effort visibility only.
    });
  });
}
