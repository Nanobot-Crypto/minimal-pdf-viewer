/** Interfaces que las vistas de documento usan para hablar con la aplicación. */

import type { FavoriteEntry } from '../core/types';
import type { NoteEntry, NoteInput } from '../core/notes';

export interface ViewHost {
  setStatus(parts: { left?: string; right?: string }): void;
  /** Pinta una sección en el panel lateral. */
  sidebarShow(viewId: string, render: (host: HTMLElement) => void): void;
  /** Registra varias secciones de golpe y redibuja una sola vez. */
  sidebarShowAll(views: Record<string, (host: HTMLElement) => void>): void;
  favoritesOf(fileId: string): FavoriteEntry[];
  toggleFavorite(entry: Omit<FavoriteEntry, 'at'>): void;
  /** Notas del documento (almacén local, fuera del archivo original). */
  notesOf(docId: string): NoteEntry[];
  addNote(input: NoteInput): NoteEntry;
  updateNote(id: string, patch: Pick<NoteEntry, 'text'> & Partial<Pick<NoteEntry, 'page'>>): void;
  removeNote(id: string): void;
  /** Traslada las notas a otro documento (tras «Guardar como»). */
  rekeyNotes(fromId: string, toId: string, toName: string): void;
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
