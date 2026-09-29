import path from 'node:path';

/**
 * Deep-link scheme that delivers the community build's browser OAuth callback.
 * The enterprise build signs in with an in-app password flow and must never
 * claim this scheme: the OS hands the protocol to whichever application
 * registered last, so registering here would hijack the community build's
 * login redirect on machines that have both installed.
 */
export const ZHIYUAN_DEEP_LINK_SCHEME = 'zhiyuan';

export interface ZhiyuanDeepLinkRegistrationEnvironment {
  readonly isEnterpriseBuild: boolean;
  readonly isDefaultApp: boolean;
  readonly entryPoint?: string;
  readonly execPath: string;
}

export interface ZhiyuanDeepLinkRegistrar {
  setAsDefaultProtocolClient(scheme: string, execPath?: string, args?: string[]): boolean;
}

export function registerZhiyuanDeepLinkProtocol(
  registrar: ZhiyuanDeepLinkRegistrar,
  environment: ZhiyuanDeepLinkRegistrationEnvironment,
): void {
  if (environment.isEnterpriseBuild) {
    console.log('[DeepLink] Enterprise build detected; skipping zhiyuan:// protocol registration.');
    return;
  }
  // In development Electron needs the app entry point before the callback URL;
  // otherwise Windows treats the URL itself as the application to launch.
  if (environment.isDefaultApp && environment.entryPoint) {
    registrar.setAsDefaultProtocolClient(ZHIYUAN_DEEP_LINK_SCHEME, environment.execPath, [
      path.resolve(environment.entryPoint),
    ]);
    return;
  }
  registrar.setAsDefaultProtocolClient(ZHIYUAN_DEEP_LINK_SCHEME);
}
