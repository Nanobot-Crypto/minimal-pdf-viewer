/** Lógica de pestañas: abrir, cerrar, reordenar, activar. */

import type { DocKind, Tab } from './types';

let counter = 0;

export function createTab(input: {
  fileId: string;
  name: string;
  kind: DocKind;
  draft?: string;
  page?: number;
}): Tab {
  return {
    id: `t${++counter}`,
    fileId: input.fileId,
    name: input.name,
    kind: input.kind,
    dirty: Boolean(input.draft),
    status: 'loading',
    draft: input.draft,
    page: input.page ?? 1,
    zoom: 'page-width',
    rotation: 0,
    scrollTop: 0,
    cursor: 0,
    mdMode: 'split',
  };
}

/** Alinea el contador tras restaurar una sesión. */
export function syncTabCounter(tabs: Tab[]): void {
  for (const t of tabs) {
    const n = Number(t.id.replace(/^t/, ''));
    if (Number.isFinite(n) && n > counter) counter = n;
  }
}

export function findIndexByFile(tabs: Tab[], fileId: string): number {
  return tabs.findIndex((t) => t.fileId === fileId);
}

export function closeTab(tabs: Tab[], id: string): { tabs: Tab[]; activeIndex: number; removed: Tab } {
  const i = tabs.findIndex((t) => t.id === id);
  if (i < 0) return { tabs, activeIndex: 0, removed: tabs[0] };
  const removed = tabs[i];
  const next = tabs.filter((t) => t.id !== id);
  return { tabs: next, activeIndex: Math.min(i, Math.max(0, next.length - 1)), removed };
}

export function moveTab(tabs: Tab[], from: number, to: number): Tab[] {
  if (from === to || from < 0 || from >= tabs.length || to < 0 || to >= tabs.length) return tabs;
  const next = tabs.slice();
  const [t] = next.splice(from, 1);
  next.splice(to, 0, t);
  return next;
}

export function nextIndex(current: number, len: number, delta: number): number {
  if (len === 0) return 0;
  return (current + delta + len) % len;
}
