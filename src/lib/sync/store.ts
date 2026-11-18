// Minimal external store for useSyncExternalStore.
export class Store<T> {
  private listeners = new Set<() => void>();
  constructor(private value: T) {}
  get = (): T => this.value;
  set(next: T): void {
    if (next === this.value) return;
    this.value = next;
    for (const l of this.listeners) l();
  }
  update(fn: (v: T) => T): void {
    this.set(fn(this.value));
  }
  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
}
