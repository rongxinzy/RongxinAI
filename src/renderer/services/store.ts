/**
 * Persistent Key-Value store adapter for Electron's main process SQLite KV store (`window.electron.store`).
 *
 * NOTE: This is an asynchronous persistent storage service, completely separate and distinct from
 * the in-memory synchronous Redux state store located in `src/renderer/store/`.
 */
interface LocalStore {
  getItem<T>(key: string): Promise<T | null>;
  setItem<T>(key: string, value: T): Promise<void>;
  removeItem(key: string): Promise<void>;
}

class LocalStoreService implements LocalStore {
  async getItem<T>(key: string): Promise<T | null> {
    try {
      const value = await window.electron.store.get(key);
      return value || null;
    } catch (error) {
      console.error('Failed to get item from store:', error);
      return null;
    }
  }

  async setItem<T>(key: string, value: T): Promise<void> {
    try {
      await window.electron.store.set(key, value);
    } catch (error) {
      console.error('Failed to set item in store:', error);
      throw error;
    }
  }

  async removeItem(key: string): Promise<void> {
    try {
      await window.electron.store.remove(key);
    } catch (error) {
      console.error('Failed to remove item from store:', error);
      throw error;
    }
  }
}

export const localStore = new LocalStoreService();
