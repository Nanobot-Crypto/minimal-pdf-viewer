/** Pruebas del almacén por documento: posiciones de lectura y borradores. */

import { describe, expect, it } from 'vitest';
import {
  MAX_DRAFTS,
  MAX_POSITIONS,
  MAX_ZOOM,
  MIN_ZOOM,
  clampPage,
  clampPosition,
  draftFor,
  emptyDocStore,
  parseDocStore,
  putDraft,
  putPosition,
  removeDraft,
  sanitizePosition,
  serializeDocStore,
  shouldOfferRecovery,
  type PdfPosition,
} from '../src/core/docstore';

const pos = (over: Partial<PdfPosition> = {}): PdfPosition => ({
  docId: '/docs/a.pdf',
  docName: 'a.pdf',
  page: 3,
  zoom: 1.25,
  fit: 'custom',
  pageCount: 5,
  updated: 1000,
  ...over,
});

describe('posiciones: saneado', () => {
  it('normaliza valores fuera de rango sin fallar', () => {
    const p = sanitizePosition({
      docId: '/a.pdf',
      page: -4,
      zoom: 99,
      fit: 'lo-que-sea',
      pageCount: 'x',
      updated: 'no',
    })!;
    expect(p.page).toBe(1);
    expect(p.zoom).toBe(MAX_ZOOM);
    expect(p.fit).toBe('custom');
    expect(p.pageCount).toBe(0);
    expect(p.updated).toBe(0);
  });

  it('rechaza entradas sin documento o corruptas', () => {
    expect(sanitizePosition(null)).toBeNull();
    expect(sanitizePosition({})).toBeNull();
    expect(sanitizePosition({ docId: '' })).toBeNull();
    expect(sanitizePosition('texto')).toBeNull();
  });

  it('conserva los modos de ajuste conocidos', () => {
    expect(sanitizePosition(pos({ fit: 'page-width' }))!.fit).toBe('page-width');
    expect(sanitizePosition(pos({ fit: 'page-fit' }))!.fit).toBe('page-fit');
    expect(sanitizePosition(pos({ zoom: 0.01 }))!.zoom).toBe(MIN_ZOOM);
  });
});

describe('posiciones: cambios en el archivo', () => {
  it('recorta la página si el documento tiene menos páginas', () => {
    const clamped = clampPosition(pos({ page: 90, pageCount: 120 }), 10);
    expect(clamped.page).toBe(10);
  });

  it('clampPage nunca sale del rango válido', () => {
    expect(clampPage(0, 5)).toBe(1);
    expect(clampPage(3, 5)).toBe(3);
    expect(clampPage(99, 5)).toBe(5);
    expect(clampPage(3, 0)).toBe(3); // total desconocido: no estorba
    expect(clampPage(Number.NaN, 5)).toBe(1);
  });

  it('una posición saneada siempre se puede aplicar', () => {
    // Archivo movido/cambiado: la entrada sigue siendo inofensiva.
    const p = sanitizePosition({ docId: '/otro/ruta.pdf', page: 500, zoom: 3, fit: 'custom' })!;
    expect(p.page).toBe(500);
    expect(clampPosition(p, 3).page).toBe(3);
  });
});

describe('docstore: persistencia', () => {
  it('hace ida y vuelta por JSON sin pérdidas', () => {
    let store = emptyDocStore();
    store = putPosition(store, pos());
    store = putDraft(store, { docId: '/docs/a.md', docName: 'a.md', text: '# borrador', updated: 5 });
    const round = parseDocStore(serializeDocStore(store));
    expect(round.positions['/docs/a.pdf'].page).toBe(3);
    expect(round.drafts['/docs/a.md'].text).toBe('# borrador');
  });

  it('tolera JSON corrupto o de estructura desconocida', () => {
    expect(parseDocStore(null).positions).toEqual({});
    expect(parseDocStore('no es json').drafts).toEqual({});
    expect(parseDocStore('{"version":2}').positions).toEqual({});
    expect(parseDocStore('{"positions":{"a":42}}').positions).toEqual({});
  });
});

describe('docstore: posiciones', () => {
  it('inserta y actualiza por identificador de documento', () => {
    let store = emptyDocStore();
    store = putPosition(store, pos({ page: 2 }));
    store = putPosition(store, pos({ page: 7, updated: 2000 }));
    expect(Object.keys(store.positions)).toHaveLength(1);
    expect(store.positions['/docs/a.pdf'].page).toBe(7);
  });

  it('recorta el almacén conservando lo más reciente', () => {
    let store = emptyDocStore();
    for (let i = 0; i < MAX_POSITIONS + 20; i++) {
      store = putPosition(store, pos({ docId: `f${i}.pdf`, docName: `f${i}.pdf`, updated: i }));
    }
    expect(Object.keys(store.positions)).toHaveLength(MAX_POSITIONS);
    expect(store.positions['f0.pdf']).toBeUndefined();
    expect(store.positions[`f${MAX_POSITIONS + 19}.pdf`]).toBeDefined();
  });
});

describe('docstore: borradores de recuperación', () => {
  it('guarda, consulta y elimina borradores', () => {
    let store = emptyDocStore();
    store = putDraft(store, { docId: '/a.md', docName: 'a.md', text: 'cambios', updated: 1 });
    expect(draftFor(store, '/a.md')!.text).toBe('cambios');
    store = removeDraft(store, '/a.md');
    expect(draftFor(store, '/a.md')).toBeNull();
  });

  it('un texto vacío elimina la entrada (no hay nada que recuperar)', () => {
    let store = emptyDocStore();
    store = putDraft(store, { docId: '/a.md', docName: 'a.md', text: 'x', updated: 1 });
    store = putDraft(store, { docId: '/a.md', docName: 'a.md', text: '', updated: 2 });
    expect(draftFor(store, '/a.md')).toBeNull();
  });

  it('solo ofrece recuperación si el borrador difiere del archivo', () => {
    const draft = draftFor(
      putDraft(emptyDocStore(), { docId: '/a.md', docName: 'a.md', text: 'nuevo', updated: 1 }),
      '/a.md',
    );
    expect(shouldOfferRecovery(draft, 'nuevo')).toBe(false);
    expect(shouldOfferRecovery(draft, 'lo del archivo')).toBe(true);
    expect(shouldOfferRecovery(null, 'lo del archivo')).toBe(false);
  });

  it('recorta los borradores al límite, con los más recientes', () => {
    let store = emptyDocStore();
    for (let i = 0; i < MAX_DRAFTS + 5; i++) {
      store = putDraft(store, { docId: `d${i}.md`, docName: `d${i}.md`, text: `t${i}`, updated: i });
    }
    expect(Object.keys(store.drafts)).toHaveLength(MAX_DRAFTS);
    expect(store.drafts['d0.md']).toBeUndefined();
    expect(store.drafts[`d${MAX_DRAFTS + 4}.md`]).toBeDefined();
  });
});
