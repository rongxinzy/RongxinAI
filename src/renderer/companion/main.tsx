import '../index.css';
import ReactDOM from 'react-dom/client';
import { TooltipProvider } from '@shared/components/ui/tooltip';
import { CompanionView } from './CompanionView';
import type { CompanionWindowApi } from '../../shared/companion/types';
import { createCompanionPreviewApi } from './previewApi';

declare global {
  interface Window {
    companion?: CompanionWindowApi;
  }
}

const root = document.getElementById('root');
if (import.meta.env.DEV && !window.companion) {
  window.companion = createCompanionPreviewApi();
  document.documentElement.dataset.companionPreview = 'true';
}
if (!root) throw new Error('Missing companion root');
ReactDOM.createRoot(root).render(
  <TooltipProvider>
    <CompanionView />
  </TooltipProvider>,
);
