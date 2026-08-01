/**
 * Warms lazily loaded feature-area chunks on hover/focus intent so the
 * Suspense fallback is rarely visible when the user actually clicks
 * (issue #141). Import specifiers must match the React.lazy declarations
 * in App.tsx so the browser reuses the same chunk.
 */
export type PrefetchableFeatureView =
  | 'settings'
  | 'skills'
  | 'scheduledTasks'
  | 'mcp'
  | 'localInference'
  | 'expert';

export const prefetchFeatureView = (view: PrefetchableFeatureView): void => {
  switch (view) {
    case 'settings':
      void import('./Settings');
      break;
    case 'skills':
      void import('./skills');
      break;
    case 'scheduledTasks':
      void import('./scheduledTasks');
      break;
    case 'mcp':
      void import('./mcp');
      break;
    case 'localInference':
      void import('./localInference');
      break;
    case 'expert':
      void import('./expert/ExpertView');
      break;
  }
};
