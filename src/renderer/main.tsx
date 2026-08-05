import './index.css';

import { TooltipProvider } from '@shared/components/ui/tooltip';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';

import {
  LlamaCppModelLaunchLogWindowQuery,
  LlamaCppModelLaunchLogWindowView,
} from '../shared/llamacpp';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Failed to find the root element');
}

const routeParams = new URLSearchParams(window.location.search);
const isModelLaunchLogWindow =
  routeParams.get(LlamaCppModelLaunchLogWindowQuery.View) ===
  LlamaCppModelLaunchLogWindowView.ModelLaunchLog;

const root = ReactDOM.createRoot(rootElement);
let channelRunUnsubscribe: (() => void) | null = null;

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

  // Channel/Cron runs are projected into a read-only activity list; they
  // never become cowork sessions (issue #225).
  const { recordChannelRun } = await import('./store/slices/activitySlice');
  channelRunUnsubscribe?.();
  channelRunUnsubscribe = window.electron.channelRun.onRunEvent(summary => {
    store.dispatch(recordChannelRun(summary));
  });

  root.render(
    <React.StrictMode>
      <Provider store={store}>
        <App />
      </Provider>
    </React.StrictMode>,
  );
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    channelRunUnsubscribe?.();
    channelRunUnsubscribe = null;
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
