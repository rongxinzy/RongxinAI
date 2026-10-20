import type { MagpieManager } from './manager';

type ManagerWithWeb = MagpieManager & {
  webRequest(route: string, init?: RequestInit): Promise<Response>;
};

/** @internal Used by routingUsageApi.ts */
export function magpieManagementRequest(
  manager: MagpieManager,
  route: string,
  init?: RequestInit,
): Promise<Response> {
  return (manager as ManagerWithWeb).webRequest(route, init);
}
