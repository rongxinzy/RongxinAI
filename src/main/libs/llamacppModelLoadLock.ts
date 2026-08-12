export class LlamaCppModelLoadLock {
  private activeModelName: string | null = null;

  getActiveModelName(): string | null {
    return this.activeModelName;
  }

  async runExclusive<T>(
    modelName: string,
    action: () => Promise<T>,
    createBlockedError: (activeModelName: string) => Error,
  ): Promise<T> {
    if (this.activeModelName) {
      throw createBlockedError(this.activeModelName);
    }

    this.activeModelName = modelName;
    try {
      return await action();
    } finally {
      if (this.activeModelName === modelName) {
        this.activeModelName = null;
      }
    }
  }
}
