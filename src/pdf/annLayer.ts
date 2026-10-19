/**
 * Capa DOM de anotaciones: pinta el modelo sobre cada página del visor y
 * gestiona selección, movimiento y redimensionado con el ratón.
 *
 * La geometría vive en `src/pdf/annotations.ts` (pura y testeable); aquí solo
 * hay posicionamiento por viewport de pdf.js, SVG/CSS y eventos.
 */

import {
  cloneAnnot,
  quadToViewportRect,
  translateAnnot,
  scaleAnnot,
  type CommentAnnotation,
  type ImageAnnotation,
  type InkAnnotation,
  type PdfAnnot,
  type RectLike,
  type ShapeAnnotation,
  type TextAnnotation,
  type ToPdfPoint,
  type ToViewportPoint,
  type AnnotationStore,
} from './annotations';

/** Anotación de texto (resaltar/subrayar/tachar). */
function isTextAnn(a: PdfAnnot): a is TextAnnotation {
  return a.type === 'highlight' || a.type === 'underline' || a.type === 'strikeout';
}

export interface PageGeom {
  element: HTMLElement;
  toPdf: ToPdfPoint;
  toViewport: ToViewportPoint;
}

export function clientPointToPdf(
  page: PageGeom,
  pageRect: RectLike,
  x: number,
  y: number,
): [number, number] {
  return page.toPdf(x - pageRect.left, y - pageRect.top);
}

type DragMode = 'move' | 'resize';

interface DragState {
  id: string;
  mode: DragMode;
  from: PdfAnnot;
  startPdf: [number, number];
  moved: boolean;
}

/** Rectángulo en coordenadas del visor para cualquier anotación. */
function annotViewportRect(ann: PdfAnnot, geom: PageGeom): RectLike {
  if (isTextAnn(ann)) {
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const q of ann.quads) {
      const r = quadToViewportRect(q, geom.toViewport);
      left = Math.min(left, r.left);
      top = Math.min(top, r.top);
      right = Math.max(right, r.right);
      bottom = Math.max(bottom, r.bottom);
    }
    return { left, top, right, bottom };
  }
  if (ann.type === 'comment') {
    const [x1, y1] = geom.toViewport(ann.x, ann.y + 22);
    const [x2, y2] = geom.toViewport(ann.x + 22, ann.y);
    return { left: Math.min(x1, x2), top: Math.min(y1, y2), right: Math.max(x1, x2), bottom: Math.max(y1, y2) };
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
    const [ax, ay] = geom.toViewport(minX, maxY);
    const [bx, by] = geom.toViewport(maxX, minY);
    return { left: Math.min(ax, bx), top: Math.min(ay, by), right: Math.max(ax, bx), bottom: Math.max(ay, by) };
  }
  const rect = (ann as ShapeAnnotation | ImageAnnotation).rect;
  const [x1, y1] = geom.toViewport(rect[0], rect[3]);
  const [x2, y2] = geom.toViewport(rect[2], rect[1]);
  return { left: Math.min(x1, x2), top: Math.min(y1, y2), right: Math.max(x1, x2), bottom: Math.max(y1, y2) };
}

export class AnnLayer {
  private layers = new Map<number, HTMLElement>();
  private drag: DragState | null = null;

  constructor(
    private store: AnnotationStore,
    private getGeom: (pageIndex: number) => PageGeom | null,
    private onMoveCommit: (id: string, from: PdfAnnot, to: PdfAnnot) => void,
  ) {
    this.store.onChange(() => this.render());
    this.onMouseDown = this.onMouseDown.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onMouseUp = this.onMouseUp.bind(this);
    window.addEventListener('mousemove', this.onMouseMove, true);
    window.addEventListener('mouseup', this.onMouseUp, true);
  }

  /** Repinta todas las capas (también al cambiar el zoom). */
  render(): void {
    for (const [pageIndex, layer] of this.layers) {
      if (!this.store.ofPage(pageIndex).length) {
        layer.remove();
        this.layers.delete(pageIndex);
        continue;
      }
      this.paintLayer(pageIndex, layer);
    }
    for (const ann of this.store.list()) {
      let layer = this.layers.get(ann.pageIndex);
      if (!layer) {
        const geom = this.getGeom(ann.pageIndex);
        if (!geom) continue;
        layer = document.createElement('div');
        layer.className = 'ann-layer';
        geom.element.append(layer);
        layer.addEventListener('mousedown', this.onMouseDown);
        this.layers.set(ann.pageIndex, layer);
      }
      this.paintLayer(ann.pageIndex, layer);
    }
  }

  private paintLayer(pageIndex: number, layer: HTMLElement): void {
    const geom = this.getGeom(pageIndex);
    if (!geom) return;
    layer.replaceChildren();
    for (const ann of this.store.ofPage(pageIndex)) {
      const selected = this.store.selected()?.id === ann.id;
      const r = annotViewportRect(ann, geom);
      const w = Math.max(2, r.right - r.left);
      const h = Math.max(2, r.bottom - r.top);

      if (isTextAnn(ann)) {
        for (const quad of ann.quads) {
          const qr = quadToViewportRect(quad, geom.toViewport);
          const mark = document.createElement('div');
          mark.className = `ann-mark ann-${ann.type}${selected ? ' selected' : ''}`;
          mark.dataset.annId = ann.id;
          mark.style.left = `${qr.left}px`;
          mark.style.top = `${qr.top}px`;
          mark.style.width = `${Math.max(2, qr.right - qr.left)}px`;
          mark.style.height = `${Math.max(2, qr.bottom - qr.top)}px`;
          mark.style.setProperty('--ann-color', ann.color);
          layer.append(mark);
        }
        continue;
      }

      if (ann.type === 'shape') {
        const shapeAnn = ann as ShapeAnnotation;
        // Grosor en puntos PDF → px del visor (aprox. con la escala actual).
        const pxPerPt = (geom.toViewport(shapeAnn.thickness, 0)[0] - geom.toViewport(0, 0)[0]) || 1;
        const stroke = Math.max(1, shapeAnn.thickness * pxPerPt);
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', `ann-mark ann-shape${selected ? ' selected' : ''}`);
        svg.dataset.annId = ann.id;
        svg.style.left = `${r.left}px`;
        svg.style.top = `${r.top}px`;
        svg.style.width = `${w}px`;
        svg.style.height = `${h}px`;
        let inner = '';
        const sw = stroke.toFixed(2);
        if (shapeAnn.shape === 'rect') {
          inner = `<rect x="${stroke}" y="${stroke}" width="${w - 2 * stroke}" height="${h - 2 * stroke}" fill="none" stroke="${shapeAnn.color}" stroke-width="${sw}"/>`;
        } else if (shapeAnn.shape === 'ellipse') {
          inner = `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${Math.max(1, w / 2 - stroke)}" ry="${Math.max(1, h / 2 - stroke)}" fill="none" stroke="${shapeAnn.color}" stroke-width="${sw}"/>`;
        } else {
          // Línea/flecha: la dirección la guarda el rect sin normalizar
          // (rect[0],rect[1] → rect[2],rect[3] en espacio PDF).
          const [x1, y1] = geom.toViewport(shapeAnn.rect[0], shapeAnn.rect[1]);
          const [x2, y2] = geom.toViewport(shapeAnn.rect[2], shapeAnn.rect[3]);
          const lx1 = Math.min(x1, x2) === r.left ? stroke : w - stroke;
          const ly1 = Math.min(y1, y2) === r.top ? stroke : h - stroke;
          const lx2 = w - (lx1 - stroke) - stroke;
          const ly2 = h - (ly1 - stroke) - stroke;
          const arrow =
            shapeAnn.shape === 'arrow'
              ? `<polygon points="${lx2},${ly2} ${lx2 - 8 * Math.sign(lx2 - lx1 || 1)},${ly2 - 4} ${lx2 - 8 * Math.sign(lx2 - lx1 || 1)},${ly2 + 4}" fill="${shapeAnn.color}"/>`
              : '';
          inner = `<line x1="${lx1}" y1="${ly1}" x2="${lx2}" y2="${ly2}" stroke="${shapeAnn.color}" stroke-width="${sw}"/>${arrow}`;
        }
        svg.innerHTML = inner;
        layer.append(svg);
        continue;
      }

      if (ann.type === 'ink') {
        const inkAnn = ann as InkAnnotation;
        const pxPerPt = (geom.toViewport(inkAnn.thickness, 0)[0] - geom.toViewport(0, 0)[0]) || 1;
        const stroke = Math.max(1, inkAnn.thickness * pxPerPt);
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', `ann-mark ann-ink${selected ? ' selected' : ''}`);
        svg.dataset.annId = ann.id;
        svg.style.left = `${r.left}px`;
        svg.style.top = `${r.top}px`;
        svg.style.width = `${w}px`;
        svg.style.height = `${h}px`;
        const polys = inkAnn.strokes
          .map((st) => {
            const pts: string[] = [];
            for (let i = 0; i + 1 < st.length; i += 2) {
              const [vx, vy] = geom.toViewport(st[i], st[i + 1]);
              pts.push(`${(vx - r.left).toFixed(1)},${(vy - r.top).toFixed(1)}`);
            }
            return `<polyline points="${pts.join(' ')}" fill="none" stroke="${inkAnn.color}" stroke-width="${stroke.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`;
          })
          .join('');
        svg.innerHTML = polys;
        layer.append(svg);
        continue;
      }

      const mark = document.createElement(ann.type === 'image' ? 'img' : 'div');
      mark.className = `ann-mark ann-${ann.type}${selected ? ' selected' : ''}`;
      (mark as HTMLElement).dataset.annId = ann.id;
      mark.style.left = `${r.left}px`;
      mark.style.top = `${r.top}px`;
      mark.style.width = `${w}px`;
      mark.style.height = `${h}px`;
      if (ann.type === 'image') {
        (mark as HTMLImageElement).src = (ann as ImageAnnotation).dataUrl;
        (mark as HTMLImageElement).draggable = false;
      } else {
        mark.title = (ann as CommentAnnotation).text || 'Comentario';
      }
      layer.append(mark);
    }

    // Tirador de redimensionado para el elemento seleccionado.
    const sel = this.store.selected();
    if (sel && !isTextAnn(sel)) {
      const layer2 = this.layers.get(sel.pageIndex);
      const geom2 = this.getGeom(sel.pageIndex);
      if (layer2 && geom2) {
        const r = annotViewportRect(sel, geom2);
        const handle = document.createElement('div');
        handle.className = 'ann-handle';
        handle.dataset.annId = sel.id;
        handle.dataset.handle = '1';
        handle.style.left = `${r.right - 5}px`;
        handle.style.top = `${r.bottom - 5}px`;
        layer2.append(handle);
      }
    }
  }

  dispose(): void {
    window.removeEventListener('mousemove', this.onMouseMove, true);
    window.removeEventListener('mouseup', this.onMouseUp, true);
    for (const layer of this.layers.values()) layer.remove();
    this.layers.clear();
  }

  /* ---------- Selección, movimiento y redimensionado ---------- */

  private onMouseDown(e: MouseEvent): void {
    const target = e.target as HTMLElement | null;
    const id = target?.dataset?.annId;
    if (!id) return;
    const ann = this.store.get(id);
    const geom = ann ? this.getGeom(ann.pageIndex) : null;
    if (!ann || !geom) return;
    e.preventDefault();
    e.stopPropagation();
    this.store.select(id);
    const pageRect = geom.element.getBoundingClientRect();
    this.drag = {
      id,
      mode: target.dataset.handle === '1' ? 'resize' : 'move',
      from: cloneAnnot(ann),
      startPdf: clientPointToPdf(geom, pageRect, e.clientX, e.clientY),
      moved: false,
    };
  }

  private onMouseMove(e: MouseEvent): void {
    const d = this.drag;
    const ann = d ? this.store.get(d.id) : null;
    if (!d || !ann) return;
    const geom = this.getGeom(ann.pageIndex);
    if (!geom) return;
    const pageRect = geom.element.getBoundingClientRect();
    const [px, py] = clientPointToPdf(geom, pageRect, e.clientX, e.clientY);
    const dx = px - d.startPdf[0];
    const dy = py - d.startPdf[1];
    if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) d.moved = true;
    const cur = this.store.get(d.id)!;
    if (d.mode === 'move') {
      const moved = translateAnnot(d.from, dx, dy);
      this.replaceGeom(cur, moved);
    } else {
      const from = d.from;
      const box = this.geomBounds(from);
      const fx = Math.max(0.05, (box.w + dx) / box.w);
      const fy = Math.max(0.05, (box.h + dy) / box.h);
      // La firma mantiene la proporción; las formas se redimensionan libres.
      const scaled = scaleAnnot(from, from.type === 'image' ? fx : fx, from.type === 'image' ? fx : fy);
      this.replaceGeom(cur, scaled);
    }
    this.render();
  }

  private onMouseUp(_e: MouseEvent): void {
    const d = this.drag;
    this.drag = null;
    const ann = d ? this.store.get(d.id) : null;
    if (!d || !ann) return;
    if (d.moved) {
      // Snapshot → operación con deshacer/rehacer.
      const to = cloneAnnot(ann);
      this.replaceGeom(ann, d.from);
      this.onMoveCommit(d.id, d.from, to);
    }
  }

  private geomBounds(ann: PdfAnnot): { w: number; h: number } {
    if (isTextAnn(ann)) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const q of ann.quads) {
        for (let i = 0; i + 1 < q.length; i += 2) {
          minX = Math.min(minX, q[i]);
          maxX = Math.max(maxX, q[i]);
          minY = Math.min(minY, q[i + 1]);
          maxY = Math.max(maxY, q[i + 1]);
        }
      }
      return { w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
    }
    if (ann.type === 'comment') return { w: 22, h: 22 };
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
      return { w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
    }
    const rect = (ann as ShapeAnnotation | ImageAnnotation).rect;
    return {
      w: Math.max(1, Math.abs(rect[2] - rect[0])),
      h: Math.max(1, Math.abs(rect[3] - rect[1])),
    };
  }

  /** Copia los campos geométricos de `src` sobre `target` (misma identidad). */
  private replaceGeom(target: PdfAnnot, src: PdfAnnot): void {
    if (isTextAnn(target)) {
      target.quads = (src as TextAnnotation).quads;
    } else if (target.type === 'shape' || target.type === 'image') {
      (target as ShapeAnnotation | ImageAnnotation).rect = (
        src as ShapeAnnotation | ImageAnnotation
      ).rect;
    } else if (target.type === 'ink') {
      (target as InkAnnotation).strokes = (src as InkAnnotation).strokes;
    } else {
      (target as { x: number; y: number }).x = (src as { x: number; y: number }).x;
      (target as { x: number; y: number }).y = (src as { x: number; y: number }).y;
    }
  }
}
