/**
 * Tracks whether a start-up sequence is still wanted.
 *
 * Starting the search bridge installs and compiles its runtime asynchronously,
 * so a stop can arrive while that work is in flight. Every step that outlives an
 * await has to re-check this gate, otherwise the server comes up after the app
 * already stopped it and survives as a stray process.
 */
export class StartupGate {
  private generation = 0;

  /** Token for one start attempt; hand it to every step that outlives an await. */
  begin(): number {
    return this.generation;
  }

  /** Anything started before this call must no longer proceed. */
  cancel(): void {
    this.generation += 1;
  }

  isCurrent(token: number): boolean {
    return token === this.generation;
  }
}
