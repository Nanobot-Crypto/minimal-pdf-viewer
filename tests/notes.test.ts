/** Pruebas del almacén de notas: CRUD, índice por documento y persistencia. */

import { describe, expect, it } from 'vitest';
import {
  addNote,
  notesFor,
  parseNotes,
  removeNote,
  rekeyNotes,
  serializeNotes,
  updateNote,
  type NoteEntry,
} from '../src/core/notes';

const base = (): NoteEntry[] => [
  ...addNote([], { docId: '/docs/a.pdf', docName: 'a.pdf', kind: 'pdf', page: 3, text: 'tercera' }),
  ...[],
];

describe('notas: alta, edición y borrado', () => {
  it('añade con identificador y marcas de tiempo', () => {
    const notes = addNote([], { docId: '/docs/a.pdf', docName: 'a.pdf', kind: 'pdf', page: 1, text: 'hola' });
    expect(notes).toHaveLength(1);
    expect(notes[0].id).toBeTruthy();
    expect(notes[0].text).toBe('hola');
    expect(notes[0].at).toBeGreaterThan(0);
    expect(notes[0].updated).toBeGreaterThan(0);
  });

  it('edita el texto y marca la actualización', () => {
    const first = addNote([], { docId: 'd', docName: 'd.pdf', kind: 'pdf', text: 'v1' })[0];
    const updated = updateNote([first], first.id, { text: 'v2' });
    expect(updated[0].text).toBe('v2');
    expect(updated[0].updated).toBeGreaterThanOrEqual(first.updated);
  });

  it('borra solo la nota indicada', () => {
    const a = addNote([], { docId: 'd', docName: 'd.pdf', kind: 'pdf', text: 'a' })[0];
    const list = addNote([a], { docId: 'd', docName: 'd.pdf', kind: 'pdf', text: 'b' });
    const after = removeNote(list, a.id);
    expect(after).toHaveLength(1);
    expect(after[0].text).toBe('b');
  });
});

describe('notas: índice por documento', () => {
  it('devuelve solo las notas del documento, ordenadas por página', () => {
    let notes = base();
    notes = addNote(notes, { docId: '/docs/a.pdf', docName: 'a.pdf', kind: 'pdf', page: 1, text: 'primera' });
    notes = addNote(notes, { docId: '/docs/b.md', docName: 'b.md', kind: 'md', text: 'otro doc' });
    const ofA = notesFor(notes, '/docs/a.pdf');
    expect(ofA.map((n) => n.page)).toEqual([1, 3]);
    expect(notesFor(notes, '/docs/b.md')).toHaveLength(1);
    expect(notesFor(notes, '/docs/inexistente.pdf')).toHaveLength(0);
  });

  it('traslada las notas al documento nuevo tras «Guardar como»', () => {
    const notes = addNote([], { docId: '/docs/viejo.md', docName: 'viejo.md', kind: 'md', text: 'x' });
    const moved = rekeyNotes(notes, '/docs/viejo.md', '/docs/nuevo.md', 'nuevo.md');
    expect(notesFor(moved, '/docs/viejo.md')).toHaveLength(0);
    expect(notesFor(moved, '/docs/nuevo.md')).toHaveLength(1);
    expect(moved[0].docName).toBe('nuevo.md');
  });
});

describe('notas: persistencia', () => {
  it('hace ida y vuelta por JSON sin pérdidas', () => {
    const notes = addNote([], { docId: '/docs/a.pdf', docName: 'a.pdf', kind: 'pdf', page: 2, text: 'guardar' });
    const round = parseNotes(serializeNotes(notes));
    expect(round).toHaveLength(1);
    expect(round[0].text).toBe('guardar');
    expect(round[0].page).toBe(2);
    expect(round[0].id).toBe(notes[0].id);
  });

  it('tolera JSON corrupto, vacío o de estructura errónea', () => {
    expect(parseNotes(null)).toEqual([]);
    expect(parseNotes('no es json')).toEqual([]);
    expect(parseNotes('{"a":1}')).toEqual([]);
    expect(parseNotes('[{"id":"n1"},{"text":"sin docId"}]')).toEqual([]);
  });
});
