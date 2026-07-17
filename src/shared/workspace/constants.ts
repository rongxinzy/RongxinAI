export const WorkspaceIpc = {
  List: 'cowork:workspace:list',
  Ensure: 'cowork:workspace:ensure',
  Rename: 'cowork:workspace:rename',
} as const;

export type WorkspaceIpc = (typeof WorkspaceIpc)[keyof typeof WorkspaceIpc];

export const WorkspaceDefault = {
  Main: 'main-workspace',
} as const;

export type WorkspaceDefault = (typeof WorkspaceDefault)[keyof typeof WorkspaceDefault];
