import './index.css';

import { TooltipProvider } from '@shared/components/ui/tooltip';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';

import {
  LlamaCppModelLaunchLogWindowQuery,
  LlamaCppModelLaunchLogWindowView,
} from '../shared/llamacpp';
import { EnterpriseSessionGate } from './components/enterprise/EnterpriseSessionGate';

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

async function renderRoot(): Promise<void> {
  if (isModelLaunchLogWindow) {
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

  const { hydrateRuns, upsertRun } = await import('./store/slices/activitySlice');
  activityUnsubscribe?.();
  activityUnsubscribe = window.electron.activity.onUpdated(run => store.dispatch(upsertRun(run)));
  const activityResult = await window.electron.activity.list();
  if (activityResult.success) store.dispatch(hydrateRuns(activityResult.runs));

  root.render(
    <React.StrictMode>
      <EnterpriseSessionGate>
        <Provider store={store}>
          <App />
        </Provider>
      </EnterpriseSessionGate>
    </React.StrictMode>,
  );
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    activityUnsubscribe?.();
    activityUnsubscribe = null;
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
