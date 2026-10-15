/** Notas de documento: se guardan aparte, sin tocar el archivo original. */

import type { DocKind } from './types';

export interface NoteEntry {
  id: string;
  /** Identificador del documento (índice principal). */
  docId: string;
  /** Nombre del documento en el momento de crear la nota (para depuración). */
  docName: string;
  kind: DocKind;
  /** Página asociada (solo PDF). */
  page?: number;
  text: string;
  /** Creación (ms). */
  at: number;
  /** Última edición (ms). */
  updated: number;
}

export type NoteInput = Omit<NoteEntry, 'id' | 'at' | 'updated'>;

let seq = 0;

function newId(): string {
  seq += 1;
  return `n${Date.now().toString(36)}${seq.toString(36)}`;
}

export function parseNotes(json: string | null): NoteEntry[] {
  if (!json) return [];
  try {
    const raw = JSON.parse(json) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((n): n is NoteEntry => {
      const e = n as Partial<NoteEntry>;
      return Boolean(e && typeof e.id === 'string' && typeof e.text === 'string' && typeof e.docId === 'string');
    });
  } catch {
    return [];
  }
}

export function serializeNotes(notes: NoteEntry[]): string {
  return JSON.stringify(notes);
}

/** Notas de un documento, por página y después por fecha. */
export function notesFor(notes: NoteEntry[], docId: string): NoteEntry[] {
  return notes
    .filter((n) => n.docId === docId)
    .sort((a, b) => (a.page ?? 0) - (b.page ?? 0) || a.at - b.at);
}

export function addNote(notes: NoteEntry[], input: NoteInput): NoteEntry[] {
  const now = Date.now();
  return [...notes, { ...input, id: newId(), at: now, updated: now }];
}

export function updateNote(
  notes: NoteEntry[],
  id: string,
  patch: Partial<Pick<NoteEntry, 'text' | 'page'>>,
): NoteEntry[] {
  return notes.map((n) => (n.id === id ? { ...n, ...patch, updated: Date.now() } : n));
}

export function removeNote(notes: NoteEntry[], id: string): NoteEntry[] {
  return notes.filter((n) => n.id !== id);
}

/** Traslada las notas a otro documento (tras «Guardar como»). */
export function rekeyNotes(
  notes: NoteEntry[],
  fromId: string,
  toId: string,
  toName: string,
): NoteEntry[] {
  return notes.map((n) => (n.docId === fromId ? { ...n, docId: toId, docName: toName } : n));
}
