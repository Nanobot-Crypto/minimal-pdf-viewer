/**
 * Anotaciones sobre PDF: texto (resaltar/subrayar/tachar), formas, comentarios
 * y firmas.
 *
 * Vía elegida (Parte 1): MEZCLA de pdf-lib (serialización) + modelo propio
 * (interfaz). pdf-lib 1.17 no trae fábricas de alto nivel de anotaciones, así
 * que se construyen diccionarios PDF **estándar** con su API de objetos:
 * `/Highlight`, `/Underline`, `/StrikeOut`, `/Square`, `/Circle`, `/Line`,
 * `/Text` (nota adhesiva) y `/Stamp` con apariencia de imagen (firma). Evince
 * y demás lectores los muestran sin nada especial, y al reabrir la copia se
 * vuelven a cargar en el modelo (editables).
 *
 * Extensibilidad (Parte 2): cada tipo nuevo = entrada en `ANN_TOOLS` +
 * serializador en `saveAnnotatedPdf` + mapeo en `annotationsFromPdfjsData`.
 * Ver docs/ARCHITECTURE.md.
 *
 * Este módulo no toca las notas locales (src/core/notes.ts): son otra cosa.
 */

/* ------------------------------------------------------------------ */
/* Tipos y colores                                                     */
/* ------------------------------------------------------------------ */

export type AnnType = 'highlight' | 'underline' | 'strikeout';
export type ShapeKind = 'rect' | 'ellipse' | 'line' | 'arrow';

/** [x1, y1, x2, y2] en espacio PDF (y crece hacia arriba). */
export type PdfRect = [number, number, number, number];

interface AnnotBase {
  id: string;
  /** Página (índice 0-based). */
  pageIndex: number;
}

export interface TextAnnotation extends AnnotBase {
  type: AnnType;
  /** Color CSS (`#rrggbb`). */
  color: string;
  /** Quadrilaterals en espacio PDF: [x1,y1, x2,y2, x3,y3, x4,y4] por línea. */
  quads: number[][];
}

export interface ShapeAnnotation extends AnnotBase {
  type: 'shape';
  shape: ShapeKind;
  color: string;
  /** Grosor en puntos PDF. */
  thickness: number;
  rect: PdfRect;
}

export interface ImageAnnotation extends AnnotBase {
  type: 'image';
  /** Origen: firma dibujada en Vela. */
  kind: 'signature';
  /** PNG como data URL (almacén local, sin red). */
  dataUrl: string;
  rect: PdfRect;
}

export interface CommentAnnotation extends AnnotBase {
  type: 'comment';
  /** Punto de anclaje (esquina superior izquierda del icono). */
  x: number;
  y: number;
  text: string;
}

export interface InkAnnotation extends AnnotBase {
  type: 'ink';
  color: string;
  /** Grosor en puntos PDF. */
  thickness: number;
  /** Trazos: cada trazo es una lista de puntos [x, y] en espacio PDF. */
  strokes: number[][];
}

export type PdfAnnot =
  | TextAnnotation
  | ShapeAnnotation
  | ImageAnnotation
  | CommentAnnotation
  | InkAnnotation;

export interface AnnColor {
  id: string;
  label: string;
  hex: string;
}

/** Colores ofrecidos para texto y formas. */
export const ANN_COLORS: AnnColor[] = [
  { id: 'yellow', label: 'Amarillo', hex: '#ffd400' },
  { id: 'green', label: 'Verde', hex: '#4caf50' },
  { id: 'pink', label: 'Rosa', hex: '#ff6ea9' },
  { id: 'blue', label: 'Azul', hex: '#4a90e2' },
];

/** Colores de la firma (negro y azul). */
export const SIGN_COLORS: AnnColor[] = [
  { id: 'black', label: 'Negro', hex: '#111111' },
  { id: 'blue', label: 'Azul', hex: '#1a4fd6' },
];

export function isAnnColor(hex: string): boolean {
  return ANN_COLORS.some((c) => c.hex === hex);
}

/**
 * Registro de herramientas de anotación: la llave de extensibilidad.
 * `kind`: 'text' | 'shape' | 'image' | 'comment'.
 */
export interface AnnToolSpec {
  id: string;
  label: string;
  icon: string;
  kind: 'text' | 'shape' | 'image' | 'comment';
  /** Subtipo PDF estándar al guardar. */
  pdfSubtype: string;
}

export const ANN_TOOLS: AnnToolSpec[] = [
  { id: 'highlight', label: 'Resaltar', icon: 'highlight', kind: 'text', pdfSubtype: 'Highlight' },
  { id: 'underline', label: 'Subrayar', icon: 'underline', kind: 'text', pdfSubtype: 'Underline' },
  { id: 'strikeout', label: 'Tachar', icon: 'strikeout', kind: 'text', pdfSubtype: 'StrikeOut' },
];

export const INK_TOOL: AnnToolSpec = {
  id: 'ink',
  label: 'Lápiz (a mano alzada)',
  icon: 'pen',
  kind: 'shape',
  pdfSubtype: 'Ink',
};

export const SHAPE_TOOLS: AnnToolSpec[] = [
  { id: 'rect', label: 'Rectángulo', icon: 'shapeRect', kind: 'shape', pdfSubtype: 'Square' },
  { id: 'ellipse', label: 'Elipse', icon: 'shapeEllipse', kind: 'shape', pdfSubtype: 'Circle' },
  { id: 'line', label: 'Línea', icon: 'shapeLine', kind: 'shape', pdfSubtype: 'Line' },
  { id: 'arrow', label: 'Flecha', icon: 'shapeArrow', kind: 'shape', pdfSubtype: 'Line' },
];

export function isAnnType(v: string): v is AnnType {
  return v === 'highlight' || v === 'underline' || v === 'strikeout';
}

/** Estrechamiento de tipos para las anotaciones de texto. */
export function isTextAnn(a: PdfAnnot): a is TextAnnotation {
  return a.type === 'highlight' || a.type === 'underline' || a.type === 'strikeout';
}

export function isShapeKind(v: string): v is ShapeKind {
  return v === 'rect' || v === 'ellipse' || v === 'line' || v === 'arrow';
}

/** Herramienta activa de la barra: texto, forma, lápiz o selección. */
export type ActiveTool = 'select' | AnnType | ShapeKind | 'ink';

/* ------------------------------------------------------------------ */
/* Geometría pura                                                      */
/* ------------------------------------------------------------------ */

export interface RectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type ToPdfPoint = (x: number, y: number) => [number, number];
export type ToViewportPoint = (x: number, y: number) => [number, number];

export function rectsToQuads(rects: RectLike[], pageRect: RectLike, toPdf: ToPdfPoint): number[][] {
  const quads: number[][] = [];
  for (const r of rects) {
    if (!(r.right > r.left) || !(r.bottom > r.top)) continue;
    const corners: [number, number][] = [
      [r.left - pageRect.left, r.top - pageRect.top],
      [r.right - pageRect.left, r.top - pageRect.top],
      [r.left - pageRect.left, r.bottom - pageRect.top],
      [r.right - pageRect.left, r.bottom - pageRect.top],
    ];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of corners) {
      const [px, py] = toPdf(x, y);
      minX = Math.min(minX, px);
      maxX = Math.max(maxX, px);
      minY = Math.min(minY, py);
      maxY = Math.max(maxY, py);
    }
    if (!Number.isFinite(minX) || maxX - minX <= 0 || maxY - minY <= 0) continue;
    quads.push([minX, maxY, maxX, maxY, minX, minY, maxX, minY]);
  }
  return quads;
}

export function quadBounds(quad: number[]): RectLike {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < quad.length; i += 2) {
    minX = Math.min(minX, quad[i]);
    maxX = Math.max(maxX, quad[i]);
    minY = Math.min(minY, quad[i + 1]);
    maxY = Math.max(maxY, quad[i + 1]);
  }
  return { left: minX, top: maxY, right: maxX, bottom: minY };
}

export function quadToViewportRect(quad: number[], toViewport: ToViewportPoint): RectLike {
  const b = quadBounds(quad);
  const [x1, y1] = toViewport(b.left, b.top);
  const [x2, y2] = toViewport(b.right, b.bottom);
  return {
    left: Math.min(x1, x2),
    top: Math.min(y1, y2),
    right: Math.max(x1, x2),
    bottom: Math.max(y1, y2),
  };
}

export function translateQuads(quads: number[][], dx: number, dy: number): number[][] {
  return quads.map((q) => q.map((v, i) => (i % 2 === 0 ? v + dx : v + dy)));
}

export function translateRect(rect: PdfRect, dx: number, dy: number): PdfRect {
  return [rect[0] + dx, rect[1] + dy, rect[2] + dx, rect[3] + dy];
}

/** Copia profunda de una anotación (snapshots para mover/deshacer). */
export function cloneAnnot(ann: PdfAnnot): PdfAnnot {
  return JSON.parse(JSON.stringify(ann)) as PdfAnnot;
}

/** Traslada la geometría de cualquier anotación. */
export function translateAnnot(ann: PdfAnnot, dx: number, dy: number): PdfAnnot {
  const copy = cloneAnnot(ann);
  if (isTextAnn(copy)) {
    copy.quads = translateQuads(copy.quads, dx, dy);
  } else if (copy.type === 'shape' || copy.type === 'image') {
    copy.rect = translateRect(copy.rect, dx, dy);
  } else if (copy.type === 'ink') {
    copy.strokes = copy.strokes.map((st) => st.map((v, i) => (i % 2 === 0 ? v + dx : v + dy)));
  } else {
    (copy as CommentAnnotation).x += dx;
    (copy as CommentAnnotation).y += dy;
  }
  return copy;
}

/** Escala la geometría (redimensionar) desde su caja envolvente. */
export function scaleAnnot(ann: PdfAnnot, factorX: number, factorY: number): PdfAnnot {
  const copy = cloneAnnot(ann);
  const scaleRect = (r: PdfRect): PdfRect => {
    const [x1, y1, x2, y2] = r;
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);
    return [minX, minY, minX + (maxX - minX) * factorX, minY + (maxY - minY) * factorY];
  };
  if (copy.type === 'shape' || copy.type === 'image') {
    copy.rect = scaleRect(copy.rect);
  } else if (copy.type === 'ink') {
    copy.strokes = copy.strokes.map((st) =>
      st.map((v, i) => {
        const isX = i % 2 === 0;
        return v * (isX ? factorX : factorY);
      }),
    );
  } else if (isTextAnn(copy)) {
    copy.quads = copy.quads.map((q) => {
      const b = quadBounds(q);
      const minX = b.left;
      const maxX = b.right;
      const minY = b.bottom;
      const maxY = b.top;
      return [
        minX, maxY - (maxY - minY) * (1 - factorY),
        minX + (maxX - minX) * factorX, maxY - (maxY - minY) * (1 - factorY),
        minX, maxY - (maxY - minY),
        minX + (maxX - minX) * factorX, maxY - (maxY - minY),
      ];
    });
  }
  return copy;
}

/* ------------------------------------------------------------------ */
/* Modelo con deshacer/rehacer                                         */
/* ------------------------------------------------------------------ */

type AnnOp =
  | { kind: 'add'; ann: PdfAnnot }
  | { kind: 'remove'; ann: PdfAnnot }
  | { kind: 'move'; id: string; from: PdfAnnot; to: PdfAnnot };

export type AnnListener = () => void;

export class AnnotationStore {
  private items: PdfAnnot[] = [];
  private undoStack: AnnOp[] = [];
  private redoStack: AnnOp[] = [];
  private selectedId: string | null = null;
  private listeners = new Set<AnnListener>();
  private seq = 0;

  onChange(fn: AnnListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  list(): PdfAnnot[] {
    return this.items.slice();
  }

  ofPage(pageIndex: number): PdfAnnot[] {
    return this.items.filter((a) => a.pageIndex === pageIndex);
  }

  get(id: string): PdfAnnot | undefined {
    return this.items.find((a) => a.id === id);
  }

  selected(): PdfAnnot | null {
    return this.selectedId ? this.get(this.selectedId) ?? null : null;
  }

  select(id: string | null): void {
    const next = id && this.get(id) ? id : null;
    if (next === this.selectedId) return; // sin cambios: no repintar (el DOM se conserva)
    this.selectedId = next;
    this.emit();
  }

  newId(): string {
    this.seq += 1;
    return `ann-${Date.now().toString(36)}-${this.seq}`;
  }

  add(ann: PdfAnnot): void {
    this.items.push(ann);
    this.undoStack.push({ kind: 'add', ann });
    this.redoStack = [];
    this.selectedId = ann.id;
    this.emit();
  }

  remove(id: string): void {
    const idx = this.items.findIndex((a) => a.id === id);
    if (idx < 0) return;
    const [ann] = this.items.splice(idx, 1);
    this.undoStack.push({ kind: 'remove', ann });
    this.redoStack = [];
    if (this.selectedId === id) this.selectedId = null;
    this.emit();
  }

  /** Registra un movimiento/reescalado ya aplicado (snapshots completos). */
  move(id: string, from: PdfAnnot, to: PdfAnnot): void {
    const idx = this.items.findIndex((a) => a.id === id);
    if (idx < 0) return;
    this.items[idx] = cloneAnnot(to);
    this.undoStack.push({ kind: 'move', id, from: cloneAnnot(from), to: cloneAnnot(to) });
    this.redoStack = [];
    this.emit();
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): boolean {
    const op = this.undoStack.pop();
    if (!op) return false;
    this.apply(op, false);
    this.redoStack.push(op);
    this.emit();
    return true;
  }

  redo(): boolean {
    const op = this.redoStack.pop();
    if (!op) return false;
    this.apply(op, true);
    this.undoStack.push(op);
    this.emit();
    return true;
  }

  private apply(op: AnnOp, direct: boolean): void {
    if (op.kind === 'add') {
      if (direct) this.items.push(cloneAnnot(op.ann));
      else this.items = this.items.filter((a) => a.id !== op.ann.id);
    } else if (op.kind === 'remove') {
      if (direct) this.items = this.items.filter((a) => a.id !== op.ann.id);
      else this.items.push(cloneAnnot(op.ann));
    } else {
      const idx = this.items.findIndex((a) => a.id === op.id);
      if (idx < 0) return;
      this.items[idx] = cloneAnnot(direct ? op.to : op.from);
    }
  }

  loadAll(anns: PdfAnnot[]): void {
    this.items = anns.map(cloneAnnot);
    this.undoStack = [];
    this.redoStack = [];
    this.selectedId = null;
    this.emit();
  }
}

/* ------------------------------------------------------------------ */
/* Interoperabilidad con pdf.js (lectura al reabrir)                   */
/* ------------------------------------------------------------------ */

interface PdfjsAnnotationData {
  subtype?: string;
  color?: { getRgb?: () => [number, number, number] } | number[];
  rect?: number[];
  quadPoints?: ArrayLike<number> | null;
  contents?: string;
  lineCoordinates?: number[];
  lineEndingStyles?: [string, string];
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

function dataColor(data: PdfjsAnnotationData): string {
  const c = data.color;
  if (Array.isArray(c) && c.length >= 3) return rgbToHex(c[0], c[1], c[2]);
  if (c && typeof (c as { getRgb?: unknown }).getRgb === 'function') {
    const [r, g, b] = (c as { getRgb: () => [number, number, number] }).getRgb();
    return rgbToHex(r, g, b);
  }
  return ANN_COLORS[0].hex;
}

function dataRect(data: PdfjsAnnotationData): PdfRect | null {
  if (!data.rect || data.rect.length !== 4) return null;
  const [x1, y1, x2, y2] = data.rect as number[];
  return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
}

let fileSeq = 0;

/** Convierte los datos de anotación de pdf.js en el modelo propio. */
export function annotationsFromPdfjsData(data: PdfjsAnnotationData, pageIndex: number): PdfAnnot | null {
  const subtype = data.subtype ?? '';
  const id = `file-${pageIndex}-${(fileSeq += 1)}`;
  const rect = dataRect(data);

  if (subtype === 'Highlight' || subtype === 'Underline' || subtype === 'StrikeOut') {
    const type: AnnType =
      subtype === 'Highlight' ? 'highlight' : subtype === 'Underline' ? 'underline' : 'strikeout';
    const quads: number[][] = [];
    const qp = data.quadPoints;
    if (qp && qp.length >= 8 && qp.length % 8 === 0) {
      for (let i = 0; i + 7 < qp.length; i += 8) {
        quads.push([qp[i], qp[i + 1], qp[i + 2], qp[i + 3], qp[i + 4], qp[i + 5], qp[i + 6], qp[i + 7]]);
      }
    } else if (rect) {
      quads.push([rect[0], rect[3], rect[2], rect[3], rect[0], rect[1], rect[2], rect[1]]);
    }
    if (!quads.length) return null;
    return { id, pageIndex, type, color: dataColor(data), quads };
  }

  if (subtype === 'Square' || subtype === 'Circle') {
    if (!rect) return null;
    return {
      id,
      pageIndex,
      type: 'shape',
      shape: subtype === 'Square' ? 'rect' : 'ellipse',
      color: dataColor(data),
      thickness: 1.5,
      rect,
    };
  }

  if (subtype === 'Line') {
    const lc = data.lineCoordinates;
    const r: PdfRect =
      lc && lc.length === 4
        ? [Math.min(lc[0], lc[2]), Math.min(lc[1], lc[3]), Math.max(lc[0], lc[2]), Math.max(lc[1], lc[3])]
        : rect ?? [0, 0, 1, 1];
    const ends = data.lineEndingStyles ?? ['None', 'None'];
    const arrow = ends.some((e) => /Arrow/i.test(e ?? ''));
    return {
      id,
      pageIndex,
      type: 'shape',
      shape: arrow ? 'arrow' : 'line',
      color: dataColor(data),
      thickness: 1.5,
      rect: r,
    };
  }

  if (subtype === 'Ink') {
    const lists = (data as { inkList?: number[][] }).inkList;
    const strokes = (lists ?? []).map((st) => (Array.isArray(st) ? st.slice() : [])).filter((st) => st.length >= 2);
    if (!strokes.length && rect) {
      // Sin inkList no hay trazos que reconstruir.
      return null;
    }
    return {
      id,
      pageIndex,
      type: 'ink',
      color: dataColor(data),
      thickness: 1.5,
      strokes,
    };
  }

  if (subtype === 'Text') {
    // Nota adhesiva: el punto de anclaje es la esquina inferior izquierda.
    if (!rect) return null;
    return {
      id,
      pageIndex,
      type: 'comment',
      x: rect[0],
      y: rect[1],
      text: data.contents ?? '',
    };
  }

  // Las firmas (Stamp con apariencia de imagen) no se re-editan: se conservan
  // tal cual al guardar de nuevo (pdf-lib reescribe el documento completo).
  return null;
}

/* ------------------------------------------------------------------ */
/* Guardado de la copia con anotaciones (pdf-lib)                      */
/* ------------------------------------------------------------------ */

export interface FormFieldValue {
  id: string;
  fieldName: string;
  type: string;
  value: unknown;
}

/** Nombre propuesto para la copia con anotaciones (nunca el del original). */
export function annCopyName(originalName: string): string {
  const base = originalName.replace(/\.pdf$/i, '');
  return `${base}-anotado.pdf`;
}

function hexToRgb01(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0xffd400;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function boundsOf(ann: PdfAnnot): PdfRect {
  if (isTextAnn(ann)) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const q of ann.quads) {
      const b = quadBounds(q);
      minX = Math.min(minX, b.left);
      maxX = Math.max(maxX, b.right);
      minY = Math.min(minY, b.bottom);
      maxY = Math.max(maxY, b.top);
    }
    return [minX, minY, maxX, maxY];
  }
  if (ann.type === 'comment') {
    return [ann.x, ann.y, ann.x + 22, ann.y + 22];
  }
  if (ann.type === 'ink') {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const st of ann.strokes) {
      for (let i = 0; i + 1 < st.length; i += 2) {
        minX = Math.min(minX, st[i]);
        maxX = Math.max(maxX, st[i]);
        minY = Math.min(minY, st[i + 1]);
        maxY = Math.max(maxY, st[i + 1]);
      }
    }
    return [minX, minY, maxX, maxY];
  }
  return (ann as ShapeAnnotation | ImageAnnotation).rect;
}

/**
 * Serializa una copia del PDF con las anotaciones estándar y los valores de
 * formulario. El original nunca se modifica.
 */
export async function saveAnnotatedPdf(opts: {
  originalBytes: Uint8Array;
  annotations: PdfAnnot[];
  formValues?: FormFieldValue[];
}): Promise<Uint8Array> {
  const pdfLib = await import('pdf-lib');
  const { PDFDocument, PDFHexString } = pdfLib;
  const pdfDoc = await PDFDocument.load(opts.originalBytes, {
    ignoreEncryption: true,
    updateMetadata: false,
  });

  // 1. Valores de formulario rellenos en el visor (pdf.js annotationStorage).
  if (opts.formValues?.length) {
    const form = pdfDoc.getForm();
    for (const fv of opts.formValues) {
      try {
        if (fv.value === undefined || fv.value === null) continue;
        if (fv.type === 'Tx') {
          form.getTextField(fv.fieldName).setText(String(fv.value));
        } else if (fv.type === 'Btn') {
          const v = fv.value;
          if (typeof v === 'boolean') {
            const box = form.getCheckBox(fv.fieldName);
            if (v) box.check();
            else box.uncheck();
          } else if (typeof v === 'string') {
            form.getRadioGroup(fv.fieldName).select(v);
          }
        } else if (fv.type === 'Ch') {
          const v = fv.value;
          const list = form.getDropdown(fv.fieldName);
          if (Array.isArray(v)) list.select(v.map(String));
          else list.select(String(v));
        }
      } catch {
        /* un campo que pdf-lib no reconozca no debe tirar el guardado */
      }
    }
    try {
      form.updateFieldAppearances();
    } catch {
      /* sin apariencias que regenerar */
    }
  }

  // 2. Anotaciones estándar.
  const ctx = pdfDoc.context;
  for (const ann of opts.annotations) {
    const page = pdfDoc.getPage(ann.pageIndex);
    const rect = boundsOf(ann);
    if (!Number.isFinite(rect[0])) continue;

    if (ann.type === 'highlight' || ann.type === 'underline' || ann.type === 'strikeout') {
      const flat: number[] = [];
      for (const q of ann.quads) flat.push(...q);
      const [r, g, b] = hexToRgb01(ann.color);
      const dict = ctx.obj({
        Type: 'Annot',
        Subtype: ann.type === 'highlight' ? 'Highlight' : ann.type === 'underline' ? 'Underline' : 'StrikeOut',
        Rect: [...rect],
        QuadPoints: flat,
        C: [r, g, b],
        CA: ann.type === 'highlight' ? 0.4 : 1,
        F: 4,
      });
      page.node.addAnnot(ctx.register(dict));
      continue;
    }

    if (ann.type === 'shape') {
      const [r, g, b] = hexToRgb01(ann.color);
      const base: Record<string, unknown> = {
        Type: 'Annot',
        Subtype: ann.shape === 'rect' ? 'Square' : ann.shape === 'ellipse' ? 'Circle' : 'Line',
        Rect: [...rect],
        C: [r, g, b],
        F: 4,
        BS: ctx.obj({ W: ann.thickness }),
      };
      if (ann.shape === 'line' || ann.shape === 'arrow') {
        base.L = [rect[0], rect[1], rect[2], rect[3]];
        base.LE = [ctx.obj('None'), ctx.obj(ann.shape === 'arrow' ? 'OpenArrow' : 'None')];
      }
      page.node.addAnnot(ctx.register(ctx.obj(base as Parameters<typeof ctx.obj>[0])));
      continue;
    }

    if (ann.type === 'ink') {
      const [r, g, b] = hexToRgb01(ann.color);
      const dict = ctx.obj({
        Type: 'Annot',
        Subtype: 'Ink',
        Rect: [...rect],
        InkList: ann.strokes.map((st) => st.slice()),
        C: [r, g, b],
        BS: ctx.obj({ W: ann.thickness }),
        F: 4,
      });
      page.node.addAnnot(ctx.register(dict));
      continue;
    }

    if (ann.type === 'comment') {
      const dict = ctx.obj({
        Type: 'Annot',
        Subtype: 'Text',
        Rect: [ann.x, ann.y, ann.x + 22, ann.y + 22],
        Contents: PDFHexString.fromText(ann.text ?? ''),
        Name: ctx.obj('Comment'),
        C: [1, 0.85, 0.3],
        F: 4,
        Open: false,
      });
      page.node.addAnnot(ctx.register(dict));
      continue;
    }

    if (ann.type === 'image') {
      // Firma: sello (/Stamp) con apariencia que dibuja el PNG → visible en
      // Evince y demás lectores como imagen estándar.
      try {
        const png = Uint8Array.from(
          atob(ann.dataUrl.replace(/^data:image\/png;base64,/, '')),
          (ch) => ch.charCodeAt(0),
        );
        const img = await pdfDoc.embedPng(png);
        const [x1, y1, x2, y2] = rect;
        const w = Math.abs(x2 - x1);
        const h = Math.abs(y2 - y1);
        const ap = ctx.stream(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} 0 0 cm /Im0 Do Q`, {
          XObject: ctx.obj({ Im0: img.ref }),
          Type: ctx.obj('XObject'),
          Subtype: ctx.obj('Form'),
          BBox: [0, 0, w, h],
        });
        const dict = ctx.obj({
          Type: 'Annot',
          Subtype: 'Stamp',
          Rect: [x1, y1, x2, y2],
          F: 4,
          AP: ctx.obj({ N: ctx.register(ap) }),
        });
        page.node.addAnnot(ctx.register(dict));
      } catch {
        /* imagen no válida: se ignora sin romper el guardado */
      }
    }
  }

  return pdfDoc.save({ useObjectStreams: false });
}
