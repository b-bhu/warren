export type CacheRead<T> = {
  value: T;
  state: 'fresh' | 'stale';
};

export class FreshStaleCache<T> {
  private entry?: { value: T; freshUntil: number; staleUntil: number };
  private pending?: Promise<T>;

  constructor(
    private readonly freshForMs: number,
    private readonly staleForMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  async read(loader: () => Promise<T>): Promise<CacheRead<T>> {
    const at = this.now();
    if (this.entry && at < this.entry.freshUntil) return { value: this.entry.value, state: 'fresh' };

    try {
      const value = await this.loadOnce(loader);
      const loadedAt = this.now();
      this.entry = {
        value,
        freshUntil: loadedAt + this.freshForMs,
        staleUntil: loadedAt + this.freshForMs + this.staleForMs,
      };
      return { value, state: 'fresh' };
    } catch (error) {
      if (this.entry && this.now() < this.entry.staleUntil) return { value: this.entry.value, state: 'stale' };
      throw error;
    }
  }

  clear() {
    this.entry = undefined;
    this.pending = undefined;
  }

  private loadOnce(loader: () => Promise<T>): Promise<T> {
    if (!this.pending) {
      this.pending = loader().finally(() => {
        this.pending = undefined;
      });
    }
    return this.pending;
  }
}
