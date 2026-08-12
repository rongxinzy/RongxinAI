export interface Workspace {
  id: string;
  name: string;
  path: string;
  isHidden: boolean;
  pinned?: boolean;
  createdAt: number;
  updatedAt: number;
}
