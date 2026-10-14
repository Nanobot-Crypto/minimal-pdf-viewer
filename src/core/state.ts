/** Estado persistente: tema, recientes, favoritos y sesión. */

import { bridge } from './bridge';
import type { FavoriteEntry, PersistedState, RecentEntry, SessionTab, Tab } from './types';

const MAX_RECENTS = 12;

export function defaultState(): PersistedState {
  return {
    version: 1,
    theme: 'system',
    sidebarOpen: false,
    sidebarView: 'auto',
    lastFolder: null,
    recents: [],
    favorites: [],
    session: [],
    activeIndex: 0,
  };
}

export function parseState(json: string | null): PersistedState {
  if (!json) return defaultState();
  try {
    const raw = JSON.parse(json) as Partial<PersistedState>;
    if (raw.version !== 1) return defaultState();
    return {
      ...defaultState(),
      ...raw,
      recents: Array.isArray(raw.recents) ? raw.recents.slice(0, MAX_RECENTS) : [],
      favorites: Array.isArray(raw.favorites) ? raw.favorites : [],
      session: Array.isArray(raw.session) ? raw.session : [],
    };
  } catch {
    return defaultState();
  }
}

export function serializeState(s: PersistedState): string {
  return JSON.stringify(s);
}

export function tabsToSession(tabs: Tab[]): SessionTab[] {
  return tabs.map((t) => ({
    fileId: t.fileId,
    name: t.name,
    kind: t.kind,
    draft: t.kind === 'md' && t.dirty ? t.draft : undefined,
    page: t.page > 1 ? t.page : undefined,
    zoom: t.zoom,
    rotation: t.rotation || undefined,
    scrollTop: t.scrollTop > 0 ? t.scrollTop : undefined,
    cursor: t.cursor > 0 ? t.cursor : undefined,
    mdMode: t.kind === 'md' ? t.mdMode : undefined,
  }));
}

export function sessionToTabs(session: SessionTab[]): Tab[] {
  return session.map((s, i) => ({
    id: `t${i + 1}`,
    fileId: s.fileId,
    name: s.name,
    kind: s.kind,
    dirty: Boolean(s.draft),
    status: 'loading',
    draft: s.draft,
    page: s.page ?? 1,
    zoom: s.zoom ?? 'page-width',
    rotation: s.rotation ?? 0,
    scrollTop: s.scrollTop ?? 0,
    cursor: s.cursor ?? 0,
    mdMode: s.mdMode ?? 'split',
  }));
}

export function pushRecent(recents: RecentEntry[], entry: Omit<RecentEntry, 'at'>): RecentEntry[] {
  const next = recents.filter((r) => r.id !== entry.id);
  next.unshift({ ...entry, at: Date.now() });
  return next.slice(0, MAX_RECENTS);
}

export function toggleFavorite(
  favorites: FavoriteEntry[],
  entry: Omit<FavoriteEntry, 'at'>,
): FavoriteEntry[] {
  const exists = favorites.find((f) => f.id === entry.id && f.page === entry.page);
  if (exists) return favorites.filter((f) => f !== exists);
  return [...favorites, { ...entry, at: Date.now() }];
}

/** Guardado con debounce para no escribir en cada frame de scroll. */
export class StatePersistence {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private getState: () => PersistedState) {}

  schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), 400);
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    try {
      await bridge.saveState(serializeState(this.getState()));
    } catch {
      /* la persistencia es best-effort */
    }
  }
}
