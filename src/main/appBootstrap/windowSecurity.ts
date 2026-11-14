/** Web-request security: CSP headers with the isolated artifact sandbox exemption. */
import { session } from 'electron';

import { isDev } from './appEnv';
import { createContentSecurityPolicy } from '../contentSecurityPolicy';

const isArtifactSandboxUrl = (url: string): boolean => {
  try {
    const pathname = new URL(url).pathname;
    return (
      pathname.endsWith('/artifact-react-sandbox.html') ||
      pathname.includes('/vendor/react.production.min.js') ||
      pathname.includes('/vendor/react-dom.production.min.js') ||
      pathname.includes('/vendor/babel.min.js')
    );
  } catch {
    return false;
  }
};

// 设置 Content Security Policy
export const setContentSecurityPolicy = () => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    // 跳过 artifact 沙箱及其 vendor 脚本的 CSP（iframe sandbox="allow-scripts" 隔离）
    if (isArtifactSandboxUrl(details.url)) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': createContentSecurityPolicy({
          isDev,
          electronStartUrl: process.env.ELECTRON_START_URL,
        }),
      },
    });
  });
};
