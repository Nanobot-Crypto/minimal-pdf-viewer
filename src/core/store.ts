/** Store mínimo con suscripción: suficiente para el estado de la aplicación. */

export type Unsub = () => void;

export class Store<T extends object> {
  private value: T;
  private listeners = new Set<(v: T, prev: T) => void>();

  constructor(initial: T) {
    this.value = initial;
  }

  get(): T {
    return this.value;
  }

  set(next: T): void {
    const prev = this.value;
    if (prev === next) return;
    this.value = next;
    for (const fn of [...this.listeners]) fn(next, prev);
  }

  update(fn: (current: T) => T | void): void {
    const prev = this.value;
    const res = fn(this.value);
    if (res === undefined) {
      // Mutación in place: notificamos igualmente.
      if (this.value !== prev) return;
      for (const fn2 of [...this.listeners]) fn2(this.value, prev);
      return;
    }
    this.set(res);
  }

  subscribe(fn: (v: T, prev: T) => void): Unsub {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

/** Comparación superficial para selectores. */
export function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}
