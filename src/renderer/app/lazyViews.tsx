import React from 'react';

// Feature areas outside the default cowork view are code-split so they stay
// out of the initial preload graph (see issue #141).
const loadCoworkView = () =>
  import('../components/cowork').then(module => ({ default: module.CoworkView }));
// Start the default view chunk during the boot animation so first paint isn't waiting on it.
const coworkViewPromise = loadCoworkView();
export const CoworkView = React.lazy(() => coworkViewPromise);
export const SettingsPage = React.lazy(() => import('../components/settings/SettingsPage'));
export const SkillsView = React.lazy(() =>
  import('../components/skills').then(module => ({ default: module.SkillsView })),
);
export const ScheduledTasksView = React.lazy(() =>
  import('../components/scheduledTasks').then(module => ({ default: module.ScheduledTasksView })),
);
export const ActivityView = React.lazy(() =>
  import('../components/activity').then(module => ({ default: module.ActivityView })),
);
export const McpView = React.lazy(() =>
  import('../components/mcp').then(module => ({ default: module.McpView })),
);
export const LocalInferenceView = React.lazy(() =>
  import('../components/localInference').then(module => ({ default: module.LocalInferenceView })),
);
export const ExpertView = React.lazy(() => import('../components/expert/ExpertView'));
export const CodingWorkbenchView = React.lazy(() =>
  import('../components/coding').then(module => ({ default: module.CodingWorkbenchView })),
);
export const TodoView = React.lazy(() => import('../components/todo/TodoView'));

/**
 * Full-area fallback shown while a lazily loaded feature chunk downloads.
 * Content-shaped skeleton blocks with a soft staggered pulse communicate
 * "view is loading" and keep the layout stable when the real view mounts.
 */
export const lazyViewFallback = (
  <div className="flex h-full min-h-0 flex-col gap-4 p-6">
    <div className="h-9 w-48 animate-pulse rounded-lg bg-muted/40" />
    <div className="flex flex-1 flex-col gap-3">
      <div className="h-28 animate-pulse rounded-xl bg-muted/30" />
      <div className="h-28 animate-pulse rounded-xl bg-muted/30 [animation-delay:150ms]" />
      <div className="h-28 animate-pulse rounded-xl bg-muted/30 [animation-delay:300ms]" />
    </div>
  </div>
);
