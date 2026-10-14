/** Interfaces que las vistas de documento usan para hablar con la aplicación. */

import type { FavoriteEntry } from '../core/types';

export interface ViewHost {
  setStatus(parts: { left?: string; right?: string }): void;
  /** Pinta una sección en el panel lateral. */
  sidebarShow(viewId: string, render: (host: HTMLElement) => void): void;
  favoritesOf(fileId: string): FavoriteEntry[];
  toggleFavorite(entry: Omit<FavoriteEntry, 'at'>): void;
  /** Avisa de que el estado debe persistirse (con debounce). */
  stateChanged(): void;
  /** Avisa de que las pestañas deben redibujarse (indicador «sin guardar», etc.). */
  tabsChanged(): void;
  currentTheme(): 'light' | 'dark';
  openDocuments(): void;
  confirm(title: string, message: string, danger?: boolean): Promise<boolean>;
  /** Solicitud de impresión desde el propio documento. */
  printRequested(): Promise<void>;
}
