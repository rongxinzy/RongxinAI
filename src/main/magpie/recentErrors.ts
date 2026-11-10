import { extractRuntimeErrorMessage } from '../../shared/magpie/runtimeErrorMessage';
import type { MagpieDiagnosticSummary } from '../../shared/magpie/types';

type RecentError = NonNullable<MagpieDiagnosticSummary['recentErrors']>[number];

const MAX_RECENT_ERRORS = 10;

/** The bounded, in-memory list the settings page reads. */
export class RecentErrors {
  private items: RecentError[] = [];

  record(message: string, providerId?: string): void {
    this.items.unshift({ timestamp: Date.now(), message, providerId });
    if (this.items.length > MAX_RECENT_ERRORS) this.items.pop();
  }

  list(): RecentError[] {
    return this.items;
  }

  /**
   * Drops the errors a provider change made stale. Provider ids cover errors
   * recorded with one; the name prefix covers the runtime errors that carry
   * only the upstream message (`name: ...`).
   */
  clear(filter?: { providerIds?: string[]; providerNames?: string[] }): void {
    if (!filter) {
      this.items = [];
      return;
    }
    const ids = new Set(filter.providerIds ?? []);
    const names = (filter.providerNames ?? [])
      .map(name => name.trim())
      .filter(name => name.length > 0);
    this.items = this.items.filter(error => {
      if (error.providerId && ids.has(error.providerId)) return false;
      const message = extractRuntimeErrorMessage(error.message).replace(/^\s*(?:Error:\s*)+/i, '');
      return !names.some(name => message.startsWith(`${name}:`));
    });
  }
}
