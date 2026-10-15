/**
 * Estado por documento que vive **fuera** del archivo original:
 *
 * - `positions`: posición de lectura de cada PDF (página, zoom y ajuste).
 * - `drafts`: borradores de recuperación de Markdown.
 *
 * Sigue el mismo mecanismo de persistencia que las notas: un JSON local de la
 * aplicación (`vela-docstore.json` en escritorio, `localStorage` en navegador)
 * que se guarda con debounce y nunca toca los documentos del usuario.
 */

export type PdfFitMode = 'page-width' | 'page-fit' | 'custom';

export interface PdfPosition {
  /** Identificador del documento (ruta absoluta o clave interna). */
  docId: string;
  /** Nombre del documento al guardar (solo para depurar). */
  docName: string;
  page: number;
  /** Escala real (0,15–5). Solo se usa cuando `fit` es `custom`. */
  zoom: number;
  fit: PdfFitMode;
  /** Nº de páginas del documento al guardar: permite sanear posiciones si cambió. */
  pageCount: number;
  updated: number;
}

export interface DraftEntry {
  docId: string;
  docName: string;
  text: string;
  updated: number;
}

export interface DocStore {
  version: 1;
  positions: Record<string, PdfPosition>;
  drafts: Record<string, DraftEntry>;
}

export const MIN_ZOOM = 0.15;
export const MAX_ZOOM = 5;
export const MAX_POSITIONS = 400;
export const MAX_DRAFTS = 50;

export function emptyDocStore(): DocStore {
  return { version: 1, positions: {}, drafts: {} };
}

/* ------------------------------------------------------------------ */
/* Saneado                                                            */
/* ------------------------------------------------------------------ */

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Normaliza una posición cruda. Devuelve `null` si no aporta nada usable.
 * Nunca lanza: el almacén puede venir de una versión anterior o estar dañado.
 */
export function sanitizePosition(raw: unknown): PdfPosition | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<PdfPosition>;
  if (typeof r.docId !== 'string' || !r.docId) return null;
  const fit: PdfFitMode = r.fit === 'page-width' || r.fit === 'page-fit' ? r.fit : 'custom';
  const zoomRaw = num(r.zoom) ?? 1;
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoomRaw));
  const pageRaw = num(r.page) ?? 1;
  const page = Math.min(10_000_000, Math.max(1, Math.round(pageRaw)));
  const pageCount = Math.max(0, Math.round(num(r.pageCount) ?? 0));
  return {
    docId: r.docId,
    docName: typeof r.docName === 'string' ? r.docName : r.docId,
    page,
    zoom,
    fit,
    pageCount,
    updated: Math.max(0, num(r.updated) ?? 0),
  };
}

/**
 * Recorta una página al total real. Se llama con el total de páginas del
 * documento abierto: si el archivo cambió de contenido, la página se limita
 * en lugar de fallar.
 */
export function clampPage(page: number, total: number): number {
  const p = Number.isFinite(page) ? Math.round(page) : 1;
  if (!Number.isFinite(total) || total < 1) return Math.max(1, p);
  return Math.min(Math.max(1, p), Math.max(1, Math.round(total)));
}

/** Variante de `clampPage` sobre una posición completa. */
export function clampPosition(pos: PdfPosition, total: number): PdfPosition {
  const page = clampPage(pos.page, total);
  return page === pos.page ? pos : { ...pos, page };
}

function sanitizeDraft(raw: unknown): DraftEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Partial<DraftEntry>;
  if (typeof d.docId !== 'string' || !d.docId) return null;
  if (typeof d.text !== 'string') return null;
  return {
    docId: d.docId,
    docName: typeof d.docName === 'string' ? d.docName : d.docId,
    text: d.text,
    updated: Math.max(0, num(d.updated) ?? 0),
  };
}

/* ------------------------------------------------------------------ */
/* Persistencia (JSON)                                                 */
/* ------------------------------------------------------------------ */

export function parseDocStore(json: string | null): DocStore {
  const store = emptyDocStore();
  if (!json) return store;
  try {
    const raw = JSON.parse(json) as Partial<DocStore>;
    if (!raw || typeof raw !== 'object') return store;
    if (raw.positions && typeof raw.positions === 'object') {
      for (const [id, value] of Object.entries(raw.positions as Record<string, unknown>)) {
        const pos = sanitizePosition(value);
        if (pos) store.positions[id] = pos;
      }
    }
    if (raw.drafts && typeof raw.drafts === 'object') {
      for (const [id, value] of Object.entries(raw.drafts as Record<string, unknown>)) {
        const draft = sanitizeDraft(value);
        if (draft) store.drafts[id] = draft;
      }
    }
    return store;
  } catch {
    return store;
  }
}

export function serializeDocStore(store: DocStore): string {
  return JSON.stringify(store);
}

/* ------------------------------------------------------------------ */
/* Operaciones (puras: devuelven un almacén nuevo)                     */
/* ------------------------------------------------------------------ */

type Stamp = { updated: number };

function pruneByRecency<T extends Stamp>(map: Record<string, T>, max: number): Record<string, T> {
  const entries = Object.entries(map);
  if (entries.length <= max) return map;
  entries.sort((a, b) => b[1].updated - a[1].updated);
  return Object.fromEntries(entries.slice(0, max));
}

/** Inserta o actualiza la posición de un documento (índice: docId). */
export function putPosition(store: DocStore, input: Omit<PdfPosition, 'updated'> & Partial<Stamp>): DocStore {
  const pos = sanitizePosition({ ...input, updated: input.updated ?? Date.now() });
  if (!pos) return store;
  return {
    ...store,
    positions: pruneByRecency({ ...store.positions, [pos.docId]: pos }, MAX_POSITIONS),
  };
}

/** Guarda un borrador de recuperación. Un texto vacío elimina la entrada. */
export function putDraft(
  store: DocStore,
  input: { docId: string; docName: string; text: string; updated?: number },
): DocStore {
  if (!input.text) return removeDraft(store, input.docId);
  const draft = sanitizeDraft({ ...input, updated: input.updated ?? Date.now() });
  if (!draft) return store;
  return {
    ...store,
    drafts: pruneByRecency({ ...store.drafts, [draft.docId]: draft }, MAX_DRAFTS),
  };
}

export function removeDraft(store: DocStore, docId: string): DocStore {
  if (!(docId in store.drafts)) return store;
  const drafts = { ...store.drafts };
  delete drafts[docId];
  return { ...store, drafts };
}

export function draftFor(store: DocStore, docId: string): DraftEntry | null {
  return store.drafts[docId] ?? null;
}

/**
 * ¿Merece la pena ofrecer restaurar el borrador? Solo si existe y su contenido
 * difiere del archivo: si son iguales, el borrador sobra.
 */
export function shouldOfferRecovery(draft: DraftEntry | null, fileText: string): boolean {
  return Boolean(draft && draft.text !== fileText);
}
