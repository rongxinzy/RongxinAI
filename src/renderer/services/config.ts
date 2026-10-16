import { type AppConfig, CONFIG_KEYS, defaultConfig } from '../config';
import { localStore } from './store';

// Deliberately project only ordinary application preferences. Legacy credentials,
// provider catalogs and model defaults are not read into the renderer.
function preferences(value: Partial<AppConfig> | null): AppConfig {
  const next = { ...defaultConfig };
  for (const key of Object.keys(defaultConfig) as (keyof AppConfig)[]) {
    if (value && value[key] !== undefined) Object.assign(next, { [key]: value[key] });
  }
  return next;
}
export class ConfigService {
  private config: AppConfig = { ...defaultConfig };
  private pending: Promise<unknown> = Promise.resolve();
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation, operation);
    this.pending = result.catch(() => undefined);
    return result;
  }
  async init(): Promise<void> {
    await this.reload();
  }
  async reload(): Promise<AppConfig> {
    return this.enqueue(async () => {
      this.config = preferences(await localStore.getItem<AppConfig>(CONFIG_KEYS.APP_CONFIG));
      return this.config;
    });
  }
  getConfig(): AppConfig {
    return this.config;
  }
  async updateConfig(
    update: Partial<AppConfig> | ((current: AppConfig) => Partial<AppConfig> | undefined),
  ): Promise<void> {
    await this.enqueue(async () => {
      const stored = await localStore.getItem<AppConfig>(CONFIG_KEYS.APP_CONFIG);
      const current = preferences(stored);
      const patch = typeof update === 'function' ? update(current) : update;
      if (!patch) return;
      this.config = preferences({ ...current, ...patch });
      // Preserve unrelated historical storage without exposing it as live config.
      await localStore.setItem(CONFIG_KEYS.APP_CONFIG, { ...stored, ...this.config });
      window.dispatchEvent(new CustomEvent('config-updated'));
    });
  }
}
export const configService = new ConfigService();
