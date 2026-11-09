// mainWindow.ts loads dist/index.html; auxiliary windows use query parameters.
export function isMainRendererTarget(target) {
  if (target?.type !== 'page' || typeof target.webSocketDebuggerUrl !== 'string') return false;
  try {
    const url = new URL(target.url);
    return (
      url.protocol === 'file:' &&
      !url.host &&
      url.pathname.endsWith('/dist/index.html') &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

// Serialized into CDP: keep this function self-contained and read-only.
// App.tsx renders the welcome inside the SAME index.html before the main shell.
export function readMainRendererState(document) {
  const root = document.getElementById('root');
  const canvas = root?.querySelector('[data-main-canvas]');
  const sidebar = root?.querySelector('aside[data-active-view]');
  const composer = canvas?.querySelector('[role="textbox"], textarea');
  const visible = element =>
    Boolean(element?.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }));
  return {
    readyState: document.readyState,
    rootChildren: root?.childElementCount ?? 0,
    text: document.body?.innerText?.trim().slice(0, 500) ?? '',
    welcomePresent: Boolean(root?.querySelector('[data-testid="companion-welcome"]')),
    mainCanvasVisible: visible(canvas),
    sidebarVisible: visible(sidebar),
    composerVisible: visible(composer),
  };
}

export function isMainRendererReady(state) {
  return Boolean(
    state?.readyState === 'complete' &&
    state.rootChildren > 0 &&
    state.text.length >= 10 &&
    !state.welcomePresent &&
    state.mainCanvasVisible &&
    state.sidebarVisible &&
    state.composerVisible,
  );
}
