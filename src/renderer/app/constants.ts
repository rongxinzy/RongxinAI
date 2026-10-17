/**
 * Main view identifiers routed by the app shell. Values align with
 * `SidebarActiveView` in components/SidebarNavigationControls.tsx.
 */
export const MainView = {
  Cowork: 'cowork',
  Settings: 'settings',
  Skills: 'skills',
  ScheduledTasks: 'scheduledTasks',
  Activity: 'activity',
  Mcp: 'mcp',
  LocalInference: 'localInference',
  Expert: 'expert',
  Coding: 'coding',
  Todo: 'todo',
} as const;
export type MainView = (typeof MainView)[keyof typeof MainView];
