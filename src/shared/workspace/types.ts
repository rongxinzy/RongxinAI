export interface Workspace {
  id: string;
  name: string;
  /** Primary path: the session working directory (cwd). */
  path: string;
  /** Additional attached folders (excluding the primary path). */
  folders?: string[];
  isHidden: boolean;
  pinned?: boolean;
  createdAt: number;
  updatedAt: number;
}
