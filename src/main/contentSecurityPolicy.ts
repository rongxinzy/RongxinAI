export interface ContentSecurityPolicyOptions {
  readonly isDev: boolean;
  readonly electronStartUrl?: string;
}

export function createContentSecurityPolicy(options: ContentSecurityPolicyOptions): string {
  const devPort = options.electronStartUrl?.match(/:(\d+)/)?.[1] || '5175';
  const directives = [
    "default-src 'self'",
    options.isDev
      ? `script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:${devPort} ws://localhost:${devPort}`
      : "script-src 'self' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https: http: localfile:",
    'connect-src *',
    "font-src 'self' data:",
    "media-src 'self'",
    "worker-src 'self' blob:",
    "frame-src 'self' file: zhiyuan-enterprise-ui:",
    "form-action 'none'",
  ];

  return directives.join('; ');
}
