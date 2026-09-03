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
  | 'activity'
  | 'mcp'
  | 'localInference'
  | 'expert'
  | 'todo';

export const prefetchFeatureView = (view: PrefetchableFeatureView): void => {
  switch (view) {
    case 'settings':
      void import('./Settings').catch(() => undefined);
      break;
    case 'skills':
      void import('./skills').catch(() => undefined);
      break;
    case 'scheduledTasks':
      void import('./scheduledTasks').catch(() => undefined);
      break;
    case 'activity':
      void import('./activity').catch(() => undefined);
      break;
    case 'mcp':
      void import('./mcp').catch(() => undefined);
      break;
    case 'localInference':
      void import('./localInference').catch(() => undefined);
      break;
    case 'expert':
      void import('./expert/ExpertView').catch(() => undefined);
      break;
    case 'todo':
      void import('./todo/TodoView').catch(() => undefined);
      break;
  }
};
