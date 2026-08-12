export class LlamaCppServiceTransitionLock {
  private active = false;

  isActive(): boolean {
    return this.active;
  }

  async runExclusive<T>(action: () => Promise<T>, createBlockedError: () => Error): Promise<T> {
    if (this.active) {
      throw createBlockedError();
    }

    this.active = true;
    try {
      return await action();
    } finally {
      this.active = false;
    }
  }
}
