/** Tipos compartidos de Vela. */

import type { AppSettings } from './settings';

export type DocKind = 'pdf' | 'md';

export interface PickedFile {
  /** Identificador estable: ruta absoluta (escritorio) o clave interna (navegador). */
  id: string;
  name: string;
  kind: DocKind;
}

export interface DirEntryInfo {
  name: string;
  id: string;
  isDir: boolean;
  kind: DocKind | null;
}

export interface OpenFilter {
  name: string;
  extensions: string[];
}

export type WriteResult = 'ok' | 'exists' | 'cancelled' | 'downloaded';

export interface RecentEntry {
  id: string;
  name: string;
  kind: DocKind;
  at: number;
}

export interface FavoriteEntry {
  id: string;
  name: string;
  kind: DocKind;
  /** Página asociada al marcador (solo PDF). */
  page?: number;
  at: number;
}

export interface SessionTab {
  fileId: string;
  name: string;
  kind: DocKind;
  /** Borrador Markdown sin guardar. */
  draft?: string;
  page?: number;
  zoom?: string | number;
  rotation?: number;
  scrollTop?: number;
  cursor?: number;
  /** Modo de vista Markdown: dividir, solo edición o solo lectura. */
  mdMode?: MdMode;
}

export type MdMode = 'split' | 'edit' | 'preview';

export interface PersistedState {
  version: 1;
  theme: 'light' | 'dark' | 'system';
  sidebarOpen: boolean;
  sidebarView: string;
  lastFolder: string | null;
  recents: RecentEntry[];
  favorites: FavoriteEntry[];
  session: SessionTab[];
  activeIndex: number;
  /** Ajustes (tipografía, acento, atajos, autoguardado). */
  settings: AppSettings;
}

export interface Tab {
  id: string;
  fileId: string;
  name: string;
  kind: DocKind;
  dirty: boolean;
  /** Estado temporal mientras el documento carga. */
  status: 'loading' | 'ready' | 'error' | 'missing';
  error?: string;
  draft?: string;
  page: number;
  zoom: string | number;
  rotation: number;
  scrollTop: number;
  cursor: number;
  mdMode: MdMode;
}
