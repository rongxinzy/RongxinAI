import './index.css';

import { TooltipProvider } from '@shared/components/ui/tooltip';
import { isDefenseEdition } from '@shared/branding';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';

import {
  LlamaCppModelLaunchLogWindowQuery,
  LlamaCppModelLaunchLogWindowView,
} from '../shared/llamacpp';
import { EnterpriseSessionGate } from './components/enterprise/EnterpriseSessionGate';
import { ContextMenu } from './components/ContextMenu';
import { startCodingFailureNoticeListener } from './services/codingFailureNotice';
import { startRuntimeNoticeListener } from './services/runtimeNotice';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Failed to find the root element');
}

const routeParams = new URLSearchParams(window.location.search);
const isModelLaunchLogWindow =
  routeParams.get(LlamaCppModelLaunchLogWindowQuery.View) ===
  LlamaCppModelLaunchLogWindowView.ModelLaunchLog;

const root = ReactDOM.createRoot(rootElement);
let activityUnsubscribe: (() => void) | null = null;
let runtimeNoticeUnsubscribe: (() => void) | null = null;
let codingFailureUnsubscribe: (() => void) | null = null;

async function renderRoot(): Promise<void> {
  // Browser preview (`bun run web:preview`): no preload bridge, so install the IPC mock.
  // Gated on DEV and a browser UA so an Electron preload/load retry can never install mocks.
  if (
    import.meta.env.DEV &&
    !navigator.userAgent.includes('Electron/') &&
    typeof window.electron?.platform !== 'string'
  ) {
    const { installBrowserMock } = await import('./browserMock/installMock');
    installBrowserMock();
  }

  const defense = isDefenseEdition();
  if (!defense && isModelLaunchLogWindow) {
    const { ModelLaunchLogWindow } =
      await import('./components/localInference/windows/ModelLaunchLogWindow');
    root.render(
      <React.StrictMode>
        <TooltipProvider>
          <ModelLaunchLogWindow />
        </TooltipProvider>
      </React.StrictMode>,
    );
    return;
  }

  const [{ default: App }, { store }] = await Promise.all([import('./App'), import('./store')]);

  runtimeNoticeUnsubscribe?.();
  runtimeNoticeUnsubscribe = startRuntimeNoticeListener();
  codingFailureUnsubscribe?.();
  codingFailureUnsubscribe = startCodingFailureNoticeListener();

  const { hydrateRuns, upsertRun } = await import('./store/slices/activitySlice');
  activityUnsubscribe?.();
  activityUnsubscribe = window.electron.activity.onUpdated(run => store.dispatch(upsertRun(run)));
  const activityResult = await window.electron.activity.list();
  if (activityResult.success) store.dispatch(hydrateRuns(activityResult.runs));

  const SessionGate = defense ? React.Fragment : EnterpriseSessionGate;
  root.render(
    <React.StrictMode>
      <SessionGate>
        <Provider store={store}>
          <App />
          <ContextMenu />
        </Provider>
      </SessionGate>
    </React.StrictMode>,
  );
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    activityUnsubscribe?.();
    activityUnsubscribe = null;
    runtimeNoticeUnsubscribe?.();
    runtimeNoticeUnsubscribe = null;
    codingFailureUnsubscribe?.();
    codingFailureUnsubscribe = null;
  });
}

void renderRoot().catch(error => {
  console.error('Failed to render the app:', error);
  try {
    window.electron?.log?.fromRenderer?.(
      'error',
      'Renderer',
      `Failed to render the app: ${error instanceof Error ? error.message : String(error)}`,
    );
  } catch {
    // Ignore logging failures while the renderer is already failing to start.
  }
});
