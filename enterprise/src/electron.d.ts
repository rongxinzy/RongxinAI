declare module 'electron' {
  import type { SafeStorageLike } from './session/protected-file-storage.js';

  export const safeStorage: SafeStorageLike;
}
