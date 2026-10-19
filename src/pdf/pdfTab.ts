/** Vista de documento PDF: visor + miniaturas + índice + marcadores + búsqueda. */

import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { Tab } from '../core/types';
import type { ViewHost } from '../ui/host';
import { el, clear } from '../ui/dom';
import { icon } from '../ui/icons';
import { showContextMenu } from '../ui/contextMenu';
import { PdfView, type PdfSearchStats } from './viewer';
import { PdfThumbnails } from './thumbnails';
import { loadOutline, type OutlineNode } from './outline';
import { collectFormValues, filledCopyName, listFormFields, saveFilledPdf, type FormFieldInfo } from './forms';
import {
  ANN_COLORS,
  ANN_TOOLS,
  INK_TOOL,
  SHAPE_TOOLS,
  AnnotationStore,
  annotationsFromPdfjsData,
  annCopyName,
  isAnnType,
  isShapeKind,
  rectsToQuads,
  saveAnnotatedPdf,
  type ActiveTool,
  type AnnType,
  type InkAnnotation,
  type PdfAnnot,
  type ShapeAnnotation,
  type ShapeKind,
} from './annotations';
import { AnnLayer, clientPointToPdf } from './annLayer';
import { drawSignatureDialog, pickSignatureDialog } from './signature';
import { bridge } from '../core/bridge';
import type { NoteEntry } from '../core/notes';
import { textareaDialog } from '../ui/dialog';

export class PdfDocView {
  private pdf: PdfView;
  private thumbs: PdfThumbnails | null = null;
  private outline: OutlineNode[] = [];
  private findBar!: HTMLElement;
  private findInput!: HTMLInputElement;
  private findCount!: HTMLElement;
  private toolbar!: HTMLElement;
  private pageInput!: HTMLInputElement;
  private pageTotal!: HTMLElement;
  private zoomLabel!: HTMLElement;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private total = 0;
  private root: HTMLElement;
  private formFields: FormFieldInfo[] = [];
  private btnSaveForm!: HTMLElement;
  /** Anotaciones de texto (resaltar/subrayar/tachar): modelo con deshacer/rehacer. */
  private annStore = new AnnotationStore();
  private annLayer: AnnLayer | null = null;
  private annToolbar!: HTMLElement;
  private activeTool: ActiveTool = 'select';
  private activeColor: string = ANN_COLORS[0].hex;
  /** Grosor (pt) para formas y lápiz. */
  private annThickness = 1.5;
  /** Bytes originales del PDF (para generar copias sin re-leer el disco). */
  private originalBytes: Uint8Array = new Uint8Array();

  constructor(
    host: HTMLElement,
    private fileId: string,
    private name: string,
    private tab: Tab,
    private vh: ViewHost,
  ) {
    this.root = el('div', { class: 'doc doc-pdf' });
    host.append(this.root);

    this.findBar = el(
      'div',
      { class: 'findbar', hidden: true, role: 'search' },
      (this.findInput = el('input', {
        class: 'findbar-input',
        type: 'text',
        placeholder: 'Buscar en el documento…',
        'aria-label': 'Buscar en el documento',
      })),
      (this.findCount = el('span', { class: 'findbar-count', text: '0/0' })),
      el('button', { class: 'icon-btn', title: 'Anterior (Mayús+Intro)', 'aria-label': 'Anterior', onclick: () => this.pdf.findPrev() }, icon('back')),
      el('button', { class: 'icon-btn', title: 'Siguiente (Intro)', 'aria-label': 'Siguiente', onclick: () => this.pdf.findNext() }, icon('fwd')),
      el('button', { class: 'icon-btn', title: 'Cerrar (Esc)', 'aria-label': 'Cerrar búsqueda', onclick: () => this.closeFind() }, icon('close')),
    );
    this.root.append(this.findBar);

    // Barra de controles flotante: visible al mover el ratón, oculta en reposo.
    this.pageInput = el('input', {
      class: 'pdf-toolbar-pageinput',
      type: 'text',
      inputmode: 'numeric',
      'aria-label': 'Ir a la página',
      value: '1',
    }) as HTMLInputElement;
    this.pageTotal = el('span', { class: 'pdf-toolbar-total', text: '/ —' });
    this.zoomLabel = el('button', {
      class: 'pdf-toolbar-zoomlabel icon-btn',
      title: 'Ajustes de zoom',
      'aria-label': 'Ajustes de zoom',
    }, '—');
    this.toolbar = el(
      'div',
      { class: 'pdf-toolbar', hidden: true },
      el('button', { class: 'icon-btn', title: 'Página anterior', 'aria-label': 'Página anterior', onclick: () => this.prevPage() }, icon('back')),
      this.pageInput,
      this.pageTotal,
      el('button', { class: 'icon-btn', title: 'Página siguiente', 'aria-label': 'Página siguiente', onclick: () => this.nextPage() }, icon('fwd')),
      el('span', { class: 'pdf-toolbar-sep' }),
      el('button', { class: 'icon-btn', title: 'Alejar (Ctrl+-)', 'aria-label': 'Alejar', onclick: () => this.zoomOut() }, icon('zoomOut')),
      this.zoomLabel,
      el('button', { class: 'icon-btn', title: 'Acercar (Ctrl++)', 'aria-label': 'Acercar', onclick: () => this.zoomIn() }, icon('zoomIn')),
      el('button', { class: 'icon-btn', title: 'Ajustar al ancho', 'aria-label': 'Ajustar al ancho', onclick: () => this.setZoom('page-width') }, icon('fitWidth')),
      el('button', { class: 'icon-btn', title: 'Ajustar a la página', 'aria-label': 'Ajustar a la página', onclick: () => this.setZoom('page-fit') }, icon('fitPage')),
      el('button', { class: 'icon-btn', title: 'Rotar 90°', 'aria-label': 'Rotar 90°', onclick: () => this.rotate() }, icon('rotate')),
      el('span', { class: 'pdf-toolbar-sep' }),
      el('button', { class: 'icon-btn', title: 'Imprimir (Ctrl+P)', 'aria-label': 'Imprimir', onclick: () => void this.vh.printRequested() }, icon('print')),
      el('button', { class: 'icon-btn', title: 'Buscar (Ctrl+F)', 'aria-label': 'Buscar', onclick: () => this.openFind() }, icon('search')),
      (this.btnSaveForm = el(
        'button',
        {
          class: 'icon-btn',
          title: 'Guardar copia del formulario relleno…',
          'aria-label': 'Guardar copia del formulario',
          hidden: true,
          onclick: () => void this.saveFormCopy(),
        },
        icon('save'),
      )),
    );
    this.root.append(this.toolbar);

    // Barra de anotaciones (extensible: ver ANN_TOOLS en src/pdf/annotations.ts).
    this.annToolbar = el('div', { class: 'ann-toolbar', hidden: true, role: 'toolbar', 'aria-label': 'Anotaciones' });
    this.root.append(this.annToolbar);
    this.renderAnnToolbar();

    this.pageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const n = Number(this.pageInput.value);
        if (Number.isFinite(n)) this.gotoPage(n);
        this.pdf.focus();
      }
    });
    this.zoomLabel.addEventListener('click', (e) => {
      showContextMenu(e.clientX, e.clientY - 120, [
        { label: 'Ajustar al ancho', action: () => this.setZoom('page-width') },
        { label: 'Ajustar a la página', action: () => this.setZoom('page-fit') },
        { label: 'Zoom 100 %', action: () => this.setZoom(1) },
      ]);
    });
    this.root.addEventListener('mousemove', () => this.flashToolbar());
    this.root.addEventListener('mouseleave', () => this.hideToolbar());
    this.flashToolbar();

    this.pdf = new PdfView(this.root, {
      onReady: (total) => {
        this.total = total;
        this.updateStatus();
        void this.buildSidebar();
      },
      onPageChange: (page, total) => {
        this.tab.page = page;
        this.total = total;
        this.thumbs?.setCurrent(page);
        this.updateStatus();
        this.recordPosition();
        this.vh.stateChanged();
      },
      onZoomChange: (pct) => {
        // Se guarda el modo de ajuste (ancho/página/escala), no solo el valor.
        this.tab.zoom = this.pdf.getZoomMode();
        this.updateStatus(pct);
        this.recordPosition();
        this.vh.stateChanged();
      },
      onSearchStats: (s) => this.updateFindCount(s),
      onPasswordNeeded: (update) => {
        void (async () => {
          const { promptDialog } = await import('../ui/dialog');
          const pw = await promptDialog({
            title: 'Documento protegido',
            message: `«${this.name}» está protegido. Introduce la contraseña para abrirlo.`,
            input: { password: true, placeholder: 'Contraseña' },
            confirmText: 'Abrir',
          });
          if (pw === null) {
            this.pdf.dispose();
            this.root.append(
              el('div', { class: 'error-state' }, el('p', { text: 'Se canceló la apertura del documento protegido.' })),
            );
            return;
          }
          update(pw);
        })();
      },
      onError: (msg) => {
        clear(this.root);
        this.root.append(
          el(
            'div',
            { class: 'error-state' },
            el('div', { class: 'error-card' }, icon('lock'), el('h2', { text: 'No se pudo abrir el PDF' }), el('p', { class: 'error-message', text: msg })),
          ),
        );
        this.vh.setStatus({ left: msg });
      },
    });

    // Crear anotación al soltar el ratón con texto seleccionado y herramienta activa.
    this.root.addEventListener('mouseup', (e) => this.onSelectionMouseUp(e));
    // Doble clic sobre un comentario → editar su texto.
    this.root.addEventListener('dblclick', (e) => void this.onAnnotDblClick(e));
    // Formas: dibujo por arrastre sobre la página.
    this.root.addEventListener('mousedown', (e) => this.onShapeMouseDown(e));
    // Lápiz a mano alzada: dibujo sin zoom ni scroll (se consume el arrastre).
    this.root.addEventListener('mousedown', (e) => this.onInkMouseDown(e));

    this.findInput.addEventListener('input', () => {
      const q = this.findInput.value;
      if (q) this.pdf.startSearch(q);
      else this.pdf.clearSearch();
    });
    this.findInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) this.pdf.findPrev();
        else this.pdf.findNext();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.closeFind();
      }
    });
  }

  async load(bytes: Uint8Array): Promise<void> {
    // Copia de seguridad: pdf.js TRANSFIERE el buffer al worker (quedaría
    // detached) y la copia con anotaciones necesita los bytes originales.
    this.originalBytes = bytes.slice();
    await this.pdf.load(bytes, {
      initialPage: this.tab.page,
      zoom: this.tab.zoom as 'page-width' | 'page-fit' | number,
      rotation: this.tab.rotation,
    });
    if (this.tab.scrollTop > 0) this.pdf.setScrollTop(this.tab.scrollTop);
    void this.initForms();
    this.initAnnotations();
    void this.initFileAnnotations();
  }

  /* ---------- Anotaciones de texto ---------- */

  private initAnnotations(): void {
    this.annLayer = new AnnLayer(
      this.annStore,
      (pageIndex) => this.pdf.getPageGeom(pageIndex),
      (id, from, to) => this.annStore.move(id, from, to),
    );
    this.annLayer.render();
    this.annStore.onChange(() => this.flashToolbar());
  }

  /** Carga las anotaciones estándar ya presentes en el documento (reabrir copia). */
  private async initFileAnnotations(): Promise<void> {
    const doc = this.pdf.getDocument();
    if (!doc) return;
    const found: PdfAnnot[] = [];
    for (let p = 0; p < doc.numPages; p++) {
      let items: { subtype?: string; color?: unknown; rect?: number[]; quadPoints?: ArrayLike<number> | null }[] = [];
      try {
        items = (await doc.getPage(p + 1).then((page) => page.getAnnotations({ intent: 'display' }))) as never;
      } catch {
        continue;
      }
      for (const it of items) {
        const ann = annotationsFromPdfjsData(it as never, p);
        if (ann) found.push(ann);
      }
    }
    if (found.length) this.annStore.loadAll(found);
  }

  /** Barra de herramientas de anotaciones (herramienta, color, editar, guardar). */
  private renderAnnToolbar(): void {
    clear(this.annToolbar);
    const toolBtn = (
      tool: ActiveTool,
      label: string,
      iconName: Parameters<typeof icon>[0],
    ): HTMLElement =>
      el(
        'button',
        {
          class: `icon-btn ann-tool${this.activeTool === tool ? ' active' : ''}`,
          title: label,
          'aria-label': label,
          'aria-pressed': this.activeTool === tool ? 'true' : 'false',
          onclick: () => {
            this.activeTool = tool;
            this.renderAnnToolbar();
          },
        },
        icon(iconName),
      );
    this.annToolbar.append(
      toolBtn('select', 'Seleccionar / mover', 'pointer'),
      ...ANN_TOOLS.map((t) =>
        isAnnType(t.id) ? toolBtn(t.id, t.label, t.icon as Parameters<typeof icon>[0]) : el('span'),
      ),
      el('span', { class: 'pdf-toolbar-sep' }),
      ...SHAPE_TOOLS.map((t) =>
        isShapeKind(t.id) ? toolBtn(t.id, t.label, t.icon as Parameters<typeof icon>[0]) : el('span'),
      ),
      toolBtn('ink', INK_TOOL.label, INK_TOOL.icon as Parameters<typeof icon>[0]),
      el('select', {
        class: 'ann-thickness',
        title: 'Grosor (formas y lápiz)',
        'aria-label': 'Grosor',
        onchange: (e: Event) => {
          this.annThickness = Number((e.target as HTMLSelectElement).value) || 1.5;
        },
      },
        ...[1, 1.5, 3, 5].map((t) =>
          el('option', { value: String(t), text: `${t} pt`, selected: t === 1.5 || undefined }),
        ),
      ),
      el('button', {
        class: 'icon-btn',
        title: 'Comentario (nota adhesiva)',
        'aria-label': 'Comentario',
        onclick: () => void this.addCommentAt(),
      }, icon('comment')),
      el('button', {
        class: 'icon-btn',
        title: 'Firma visual (sin validez legal)',
        'aria-label': 'Firma',
        onclick: () => void this.placeSignature(),
      }, icon('pen')),
      el('span', { class: 'pdf-toolbar-sep' }),
      ...ANN_COLORS.map((c) =>
        el('button', {
          class: `ann-swatch${this.activeColor === c.hex ? ' active' : ''}`,
          title: `Color ${c.label}`,
          'aria-label': `Color ${c.label}`,
          'aria-pressed': this.activeColor === c.hex ? 'true' : 'false',
          style: `--ann-color:${c.hex}`,
          onclick: () => {
            this.activeColor = c.hex;
            this.renderAnnToolbar();
          },
        }),
      ),
      el('span', { class: 'pdf-toolbar-sep' }),
      el('button', {
        class: 'icon-btn',
        title: 'Borrar la anotación seleccionada (Supr)',
        'aria-label': 'Borrar anotación',
        onclick: () => this.annDelete(),
      }, icon('trash')),
      el('button', {
        class: 'icon-btn',
        title: 'Deshacer anotación',
        'aria-label': 'Deshacer anotación',
        onclick: () => this.annUndo(),
      }, icon('undo')),
      el('button', {
        class: 'icon-btn',
        title: 'Rehacer anotación',
        'aria-label': 'Rehacer anotación',
        onclick: () => this.annRedo(),
      }, icon('redo')),
      el('span', { class: 'pdf-toolbar-sep' }),
      el('button', {
        class: 'icon-btn',
        title: 'Guardar copia con anotaciones…',
        'aria-label': 'Guardar copia con anotaciones',
        onclick: () => void this.saveAnnotatedCopy(),
      }, icon('save')),
    );
  }

  setAnnTool(tool: ActiveTool): void {
    this.activeTool = tool;
    this.renderAnnToolbar();
  }

  setAnnColor(color: string): void {
    this.activeColor = color;
    this.renderAnnToolbar();
  }

  annUndo(): void {
    this.annStore.undo();
  }

  annRedo(): void {
    this.annStore.redo();
  }

  annDelete(): void {
    const sel = this.annStore.selected();
    if (sel) this.annStore.remove(sel.id);
  }

  hasAnnotations(): boolean {
    return this.annStore.list().length > 0;
  }

  /** Crea la anotación desde el texto seleccionado con la herramienta activa. */
  private onSelectionMouseUp(_e: MouseEvent): void {
    if (!isAnnType(this.activeTool)) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
    if (!rects.length) return;
    const total = this.pdf.getTotal();
    let created = 0;
    for (let pageIndex = 0; pageIndex < total; pageIndex++) {
      const geom = this.pdf.getPageGeom(pageIndex);
      if (!geom) continue;
      const pageRect = geom.element.getBoundingClientRect();
      const inPage = rects.filter(
        (r) =>
          r.left >= pageRect.left - 2 &&
          r.right <= pageRect.right + 2 &&
          r.top >= pageRect.top - 2 &&
          r.bottom <= pageRect.bottom + 2,
      );
      if (!inPage.length) continue;
      const quads = rectsToQuads(inPage, pageRect, geom.toPdf);
      if (!quads.length) continue;
      this.annStore.add({
        id: this.annStore.newId(),
        pageIndex,
        type: this.activeTool as AnnType,
        color: this.activeColor,
        quads,
      });
      created += 1;
    }
    if (created) sel.removeAllRanges();
  }

  /* ---------- Formas (rectángulo, elipse, línea, flecha) ---------- */

  /** Dibujo por arrastre de la forma activa sobre la página. */
  private onShapeMouseDown(e: MouseEvent): void {
    if (!isShapeKind(this.activeTool)) return;
    const pageEl = (e.target as HTMLElement | null)?.closest?.('.page') as HTMLElement | null;
    if (!pageEl) return;
    const pageIndex = Number(pageEl.dataset.pageNumber ?? 1) - 1;
    const geom = this.pdf.getPageGeom(pageIndex);
    if (!geom) return;
    e.preventDefault();
    const pageRect = geom.element.getBoundingClientRect();
    const start = clientPointToPdf(geom, pageRect, e.clientX, e.clientY);
    const shape = this.activeTool as ShapeKind;

    // Vista previa con un elemento temporal.
    const preview = document.createElement('div');
    preview.className = 'ann-preview';
    preview.style.setProperty('--ann-color', this.activeColor);
    pageEl.append(preview);
    const paint = (cx: number, cy: number): void => {
      const [px, py] = clientPointToPdf(geom, pageRect, cx, cy);
      const [vx1, vy1] = geom.toViewport(start[0], start[1]);
      const [vx2, vy2] = geom.toViewport(px, py);
      preview.style.left = `${Math.min(vx1, vx2)}px`;
      preview.style.top = `${Math.min(vy1, vy2)}px`;
      preview.style.width = `${Math.abs(vx2 - vx1)}px`;
      preview.style.height = `${Math.abs(vy2 - vy1)}px`;
      return void py;
    };
    paint(e.clientX, e.clientY);

    const onMove = (ev: MouseEvent): void => paint(ev.clientX, ev.clientY);
    const onUp = (ev: MouseEvent): void => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      preview.remove();
      const [px, py] = clientPointToPdf(geom, pageRect, ev.clientX, ev.clientY);
      if (Math.abs(px - start[0]) < 2 && Math.abs(py - start[1]) < 2) return;
      const ann: ShapeAnnotation = {
        id: this.annStore.newId(),
        pageIndex,
        type: 'shape',
        shape,
        color: this.activeColor,
        thickness: this.annThickness,
        // Para línea/flecha se guardan los extremos sin normalizar (dirección).
        rect:
          shape === 'line' || shape === 'arrow'
            ? [start[0], start[1], px, py]
            : [Math.min(start[0], px), Math.min(start[1], py), Math.max(start[0], px), Math.max(start[1], py)],
      };
      this.annStore.add(ann);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  /* ---------- Lápiz a mano alzada (anotación /Ink) ---------- */

  /**
   * Dibujo a mano alzada por arrastre. Mientras se dibuja se consume el
   * arrastre: la página no se desplaza ni hace zoom.
   */
  private onInkMouseDown(e: MouseEvent): void {
    if (this.activeTool !== 'ink') return;
    const pageEl = (e.target as HTMLElement | null)?.closest?.('.page') as HTMLElement | null;
    if (!pageEl) return;
    const pageIndex = Number(pageEl.dataset.pageNumber ?? 1) - 1;
    const geom = this.pdf.getPageGeom(pageIndex);
    if (!geom) return;
    e.preventDefault();
    e.stopPropagation();
    const pageRect = geom.element.getBoundingClientRect();
    const toPdf = (ev: MouseEvent): [number, number] =>
      clientPointToPdf(geom, pageRect, ev.clientX, ev.clientY);
    const stroke: number[] = [...toPdf(e)];

    const onMove = (ev: MouseEvent): void => {
      ev.preventDefault();
      const [x, y] = toPdf(ev);
      const last = stroke.length - 2;
      if (Math.abs(stroke[last] - x) < 0.3 && Math.abs(stroke[last + 1] - y) < 0.3) return;
      stroke.push(x, y);
    };
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (stroke.length < 4) return;
      const ann: InkAnnotation = {
        id: this.annStore.newId(),
        pageIndex,
        type: 'ink',
        color: this.activeColor,
        thickness: this.annThickness,
        strokes: [stroke],
      };
      this.annStore.add(ann);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  /* ---------- Comentarios (nota adhesiva, anotación /Text) ---------- */

  /** Crea un comentario en el centro de la página actual. */
  async addCommentAt(): Promise<void> {
    const pageIndex = Math.max(0, this.tab.page - 1);
    const geom = this.pdf.getPageGeom(pageIndex);
    if (!geom) return;
    const text = await textareaDialog({
      title: `Comentario · página ${this.tab.page}`,
      message: 'Se guarda como nota adhesiva del PDF (no son las notas locales).',
      input: { placeholder: 'Texto del comentario…' },
      confirmText: 'Añadir comentario',
    });
    if (text === null) return;
    const r = geom.element.getBoundingClientRect();
    const [x, y] = clientPointToPdf(geom, r, r.left + r.width / 2, r.top + r.height / 2);
    this.annStore.add({
      id: this.annStore.newId(),
      pageIndex,
      type: 'comment',
      x,
      y: y - 22,
      text,
    });
    this.setAnnTool('select');
    this.vh.setStatus({ right: `Comentario añadido en la página ${this.tab.page}` });
  }

  /** Doble clic sobre una anotación de comentario → editar su texto. */
  private async onAnnotDblClick(e: MouseEvent): Promise<void> {
    const el2 = (e.target as HTMLElement | null)?.closest?.('[data-ann-id]') as HTMLElement | null;
    const id = el2?.dataset?.annId;
    if (!id) return;
    const ann = this.annStore.get(id);
    if (!ann || ann.type !== 'comment') return;
    const text = await textareaDialog({
      title: 'Editar comentario',
      input: { value: ann.text },
      confirmText: 'Guardar cambios',
    });
    if (text === null) return;
    const to: PdfAnnot = { ...ann, text };
    this.annStore.move(id, ann, to);
  }

  /* ---------- Firma (visual, sin validez legal) ---------- */

  /** Coloca una firma guardada en el centro de la página actual. */
  async placeSignature(): Promise<void> {
    const sig = await pickSignatureDialog({ onDrawNew: () => void this.drawSignature() });
    if (!sig) return;
    const pageIndex = Math.max(0, this.tab.page - 1);
    const geom = this.pdf.getPageGeom(pageIndex);
    if (!geom) return;
    const img = new Image();
    const dims = await new Promise<{ w: number; h: number } | null>((resolve) => {
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve(null);
      img.src = sig.dataUrl;
    });
    const r = geom.element.getBoundingClientRect();
    const [cx, cy] = clientPointToPdf(geom, r, r.left + r.width / 2, r.top + r.height / 2);
    const w = 150;
    const h = dims ? (w * dims.h) / Math.max(1, dims.w) : 60;
    this.annStore.add({
      id: this.annStore.newId(),
      pageIndex,
      type: 'image',
      kind: 'signature',
      dataUrl: sig.dataUrl,
      rect: [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2],
    });
    this.setAnnTool('select');
    this.vh.setStatus({
      right: 'Firma colocada (visual, sin validez legal). Arrastra para mover; tirador para redimensionar.',
    });
  }

  /** Dibuja una firma nueva y la coloca (atajo desde la paleta). */
  async drawSignature(): Promise<void> {
    const dataUrl = await drawSignatureDialog();
    if (!dataUrl) return;
    const { saveSignature } = await import('./signature');
    saveSignature(this.activeColor, dataUrl);
    await this.placeSignature();
  }

  /**
   * Guarda una copia del PDF con las anotaciones (estándar) y los valores de
   * formulario rellenos. El original solo se sobrescribe con confirmación
   * explícita del usuario.
   */
  async saveAnnotatedCopy(): Promise<void> {
    const doc = this.pdf.getDocument();
    if (!doc) return;
    let bytes: Uint8Array;
    try {
      const formValues = await collectFormValues(doc);
      bytes = await saveAnnotatedPdf({
        originalBytes: this.originalBytes,
        annotations: this.annStore.list(),
        formValues,
      });
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err);
      this.vh.setStatus({ left: `No se pudo generar la copia con anotaciones: ${msg}` });
      return;
    }
    const target = await bridge.resolveSaveTarget(annCopyName(this.name), [
      { name: 'PDF', extensions: ['pdf'] },
    ]);
    if (!target) return;
    const isOriginal = target.id === this.fileId;
    const exists = await bridge.exists(target.id);
    if (isOriginal) {
      const ok = await this.vh.confirm(
        'Sobrescribir el documento original',
        `«${target.name}» es el archivo que abriste. El original perderá su contenido anterior, incluidas las anotaciones. ¿Sobrescribirlo?`,
        true,
      );
      if (!ok) return;
    } else if (exists) {
      const ok = await this.vh.confirm(
        'El archivo ya existe',
        `«${target.name}» ya existe. ¿Quieres sobrescribirlo?`,
        true,
      );
      if (!ok) return;
    }
    const res = await bridge.writeBytes(target.id, bytes, { overwrite: isOriginal || exists });
    if (res === 'ok' || res === 'downloaded') {
      this.vh.setStatus({ right: `Copia con anotaciones guardada en ${target.name}` });
    } else if (res === 'exists') {
      this.vh.setStatus({ right: 'No se sobrescribió nada: falta confirmación.' });
    }
  }

  /** Habilita el guardado de copia si el PDF tiene campos AcroForm. */
  private async initForms(): Promise<void> {
    const doc = this.pdf.getDocument();
    if (!doc) return;
    try {
      this.formFields = await listFormFields(doc);
      this.btnSaveForm.hidden = this.formFields.length === 0;
      this.btnSaveForm.title = this.formFields.length
        ? `Guardar copia del formulario relleno (${this.formFields.length} campos)`
        : 'Guardar copia del formulario relleno…';
    } catch {
      this.formFields = [];
    }
  }

  /**
   * Guarda una copia del PDF con los valores rellenos.
   * El original solo se sobrescribe si el usuario lo confirma de forma explícita.
   */
  async saveFormCopy(): Promise<void> {
    const doc = this.pdf.getDocument();
    if (!doc) return;
    let bytes: Uint8Array;
    try {
      bytes = await saveFilledPdf(doc);
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err);
      this.vh.setStatus({ left: `No se pudo generar la copia: ${msg}` });
      return;
    }
    const target = await bridge.resolveSaveTarget(filledCopyName(this.name), [
      { name: 'PDF', extensions: ['pdf'] },
    ]);
    if (!target) return;
    const isOriginal = target.id === this.fileId;
    const exists = await bridge.exists(target.id);
    if (isOriginal) {
      const ok = await this.vh.confirm(
        'Sobrescribir el documento original',
        `«${target.name}» es el archivo que abriste. El original perderá su contenido anterior. ¿Sobrescribirlo?`,
        true,
      );
      if (!ok) return;
    } else if (exists) {
      const ok = await this.vh.confirm(
        'El archivo ya existe',
        `«${target.name}» ya existe. ¿Quieres sobrescribirlo?`,
        true,
      );
      if (!ok) return;
    }
    const res = await bridge.writeBytes(target.id, bytes, { overwrite: isOriginal || exists });
    if (res === 'ok' || res === 'downloaded') {
      this.vh.setStatus({ right: `Formulario guardado en ${target.name}` });
    } else if (res === 'exists') {
      this.vh.setStatus({ right: 'No se sobrescribió nada: falta confirmación.' });
    }
  }

  get element(): HTMLElement {
    return this.root;
  }

  /** Rehace el contenido del panel lateral (al activar la pestaña). */
  refreshSidebar(): void {
    void this.buildSidebar();
  }

  getDocument(): PDFDocumentProxy | null {
    return this.pdf.getDocument();
  }

  /* ---------- Barra de controles flotante ---------- */

  private flashToolbar(): void {
    this.toolbar.hidden = false;
    this.toolbar.classList.add('visible');
    this.annToolbar.hidden = false;
    this.annToolbar.classList.add('visible');
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.hideToolbar(), 2600);
  }

  private hideToolbar(): void {
    this.toolbar.classList.remove('visible');
    this.annToolbar.classList.remove('visible');
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    setTimeout(() => {
      if (!this.toolbar.classList.contains('visible')) this.toolbar.hidden = true;
      if (!this.annToolbar.classList.contains('visible')) this.annToolbar.hidden = true;
    }, 200);
  }

  /* ---------- Barra de búsqueda ---------- */

  openFind(): void {
    this.findBar.hidden = false;
    this.findInput.focus();
    this.findInput.select();
  }

  closeFind(): void {
    this.findBar.hidden = true;
    this.pdf.clearSearch();
    this.pdf.focus();
  }

  isFindOpen(): boolean {
    return !this.findBar.hidden;
  }

  private updateFindCount(s: PdfSearchStats): void {
    this.findCount.textContent = s.total ? `${s.current}/${s.total}` : this.findInput.value ? 'sin resultados' : '0/0';
    this.findCount.classList.toggle('find-empty', Boolean(this.findInput.value) && !s.total);
  }

  /* ---------- Navegación ---------- */

  gotoPage(n: number): void {
    this.pdf.gotoPage(n);
  }

  nextPage(): void {
    this.pdf.nextPage();
  }

  prevPage(): void {
    this.pdf.prevPage();
  }

  setZoom(mode: 'page-width' | 'page-fit' | number): void {
    this.pdf.setZoom(mode);
  }

  /** Escala actual del PDF (1.0 = 100 %). */
  getZoom(): number {
    return this.pdf.getZoom();
  }

  zoomIn(): void {
    this.pdf.zoomIn();
  }

  zoomOut(): void {
    this.pdf.zoomOut();
  }

  /** Zoom multiplicativo (Ctrl+rueda / pellizco del trackpad) del documento. */
  zoomBy(factor: number): void {
    this.pdf.zoomBy(factor);
  }

  rotate(): void {
    this.pdf.rotate();
    this.tab.rotation = this.pdf.getRotation();
    this.vh.stateChanged();
  }

  /**
   * Registra la posición de lectura (página, zoom y ajuste) en el almacén
   * local por documento. Es lo que permite retomar el PDF donde se dejó.
   */
  private recordPosition(): void {
    const mode = this.pdf.getZoomMode();
    this.vh.recordPdfPosition({
      docId: this.fileId,
      docName: this.name,
      page: this.tab.page,
      total: this.total,
      zoom: this.pdf.getZoom(),
      fit: mode === 'page-width' || mode === 'page-fit' ? mode : 'custom',
    });
  }

  /* ---------- Panel lateral ---------- */

  private async buildSidebar(): Promise<void> {
    const doc = this.pdf.getDocument();
    if (!doc) return;
    if (!this.thumbs) {
      this.thumbs = new PdfThumbnails((page) => this.gotoPage(page));
    }
    this.thumbs.setDocument(doc);
    this.outline = await loadOutline(doc);

    const render = (host: HTMLElement, view: string): void => {
      clear(host);
      if (view === 'thumbs') {
        const box = el('div', { class: 'thumbs-host' });
        host.append(box);
        this.thumbs?.mount(box);
      } else if (view === 'outline') {
        host.append(this.renderOutline());
      } else if (view === 'comments') {
        host.append(this.renderComments());
      } else if (view === 'notes') {
        host.append(this.renderNotes());
      } else {
        host.append(this.renderBookmarks());
      }
    };

    // Registro en lote: un solo redibujado del panel lateral.
    this.vh.sidebarShowAll({
      thumbs: (h) => render(h, 'thumbs'),
      outline: (h) => render(h, 'outline'),
      comments: (h) => render(h, 'comments'),
      bookmarks: (h) => render(h, 'bookmarks'),
      notes: (h) => render(h, 'notes'),
    });
  }

  private renderOutline(): HTMLElement {
    const wrap = el('div', { class: 'outline-tree' });
    if (!this.outline.length) {
      wrap.append(el('p', { class: 'sidebar-empty', text: 'Este documento no tiene índice.' }));
      return wrap;
    }
    const add = (nodes: OutlineNode[], depth: number) => {
      for (const n of nodes) {
        const row = el(
          'button',
          {
            class: 'outline-row',
            style: `padding-left:${10 + depth * 12}px`,
            disabled: n.page === null || false,
          },
          el('span', { class: 'outline-title', text: n.title }),
          n.page ? el('span', { class: 'outline-page', text: String(n.page) }) : null,
        );
        row.addEventListener('click', () => {
          if (n.page) this.gotoPage(n.page);
        });
        wrap.append(row);
        if (n.children.length) add(n.children, depth + 1);
      }
    };
    add(this.outline, 0);
    return wrap;
  }

  private renderBookmarks(): HTMLElement {
    const wrap = el('div', { class: 'bookmarks' });
    const btn = el('button', {
      class: 'btn btn-block',
      text: `Marcar página ${this.tab.page}`,
      onclick: () => {
        this.vh.toggleFavorite({
          id: this.fileId,
          name: this.name,
          kind: 'pdf',
          page: this.tab.page,
        });
        this.renderBookmarkList(wrap);
      },
    });
    wrap.append(btn, el('div', { class: 'bookmark-list' }));
    this.renderBookmarkList(wrap);
    return wrap;
  }

  private renderBookmarkList(wrap: HTMLElement): void {
    const list = wrap.querySelector('.bookmark-list') as HTMLElement;
    clear(list);
    const favs = this.vh
      .favoritesOf(this.fileId)
      .slice()
      .sort((a, b) => (a.page ?? 0) - (b.page ?? 0));
    if (!favs.length) {
      list.append(el('p', { class: 'sidebar-empty', text: 'Sin páginas marcadas todavía.' }));
      return;
    }
    for (const f of favs) {
      const row = el(
        'div',
        { class: 'bookmark-row' },
        el('button', { class: 'bookmark-link', text: `Página ${f.page ?? 1}`, onclick: () => this.gotoPage(f.page ?? 1) }),
        el('button', {
          class: 'icon-btn',
          title: 'Quitar marca',
          'aria-label': 'Quitar marca',
          onclick: () => {
            this.vh.toggleFavorite({ id: f.id, name: f.name, kind: 'pdf', page: f.page });
            this.renderBookmarkList(wrap);
          },
        }, icon('close')),
      );
      list.append(row);
    }
  }

  /* ---------- Comentarios (panel lateral) ---------- */

  private renderComments(): HTMLElement {
    const wrap = el('div', { class: 'comments' });
    const list = el('div', { class: 'comment-list' });
    const renderList = (): void => {
      clear(list);
      const comments = this.annStore.list().filter((a) => a.type === 'comment');
      if (!comments.length) {
        list.append(el('p', { class: 'sidebar-empty', text: 'Sin comentarios en este documento.' }));
        return;
      }
      for (const c of comments) {
        if (c.type !== 'comment') continue;
        list.append(
          el(
            'div',
            { class: 'comment-row' },
            el('button', {
              class: 'comment-page',
              text: `Pág. ${c.pageIndex + 1}`,
              title: 'Ir a la página',
              onclick: () => this.gotoPage(c.pageIndex + 1),
            }),
            el('p', { class: 'comment-text', text: c.text || '(sin texto)' }),
            el('button', {
              class: 'icon-btn',
              title: 'Borrar comentario',
              'aria-label': 'Borrar comentario',
              onclick: () => this.annStore.remove(c.id),
            }, icon('close')),
          ),
        );
      }
    };
    renderList();
    this.annStore.onChange(renderList);
    wrap.append(
      el('button', {
        class: 'btn btn-block',
        text: `Añadir comentario (página ${this.tab.page})`,
        onclick: () => void this.addCommentAt(),
      }),
      list,
    );
    return wrap;
  }

  /* ---------- Notas ---------- */

  /** Diálogo para añadir una nota en la página actual. */
  async addNote(): Promise<void> {
    const text = await textareaDialog({
      title: `Nota · página ${this.tab.page}`,
      message: 'Se guarda con Vela; el PDF no se modifica.',
      input: { placeholder: 'Escribe la nota…' },
      confirmText: 'Guardar nota',
    });
    if (text === null) return;
    this.vh.addNote({
      docId: this.fileId,
      docName: this.name,
      kind: 'pdf',
      page: this.tab.page,
      text,
    });
    this.vh.setStatus({ right: `Nota añadida en la página ${this.tab.page}` });
  }

  private async editNote(note: NoteEntry): Promise<void> {
    const text = await textareaDialog({
      title: `Editar nota${note.page ? ` · página ${note.page}` : ''}`,
      input: { value: note.text },
      confirmText: 'Guardar cambios',
    });
    if (text === null) return;
    this.vh.updateNote(note.id, { text });
  }

  private renderNotes(): HTMLElement {
    const wrap = el('div', { class: 'notes' });
    const btn = el('button', {
      class: 'btn btn-block',
      text: `Añadir nota (página ${this.tab.page})`,
      onclick: () => void this.addNote(),
    });
    const list = el('div', { class: 'note-list' });
    wrap.append(btn, list);
    this.renderNoteList(list);
    return wrap;
  }

  private renderNoteList(list: HTMLElement): void {
    clear(list);
    const notes = this.vh.notesOf(this.fileId);
    if (!notes.length) {
      list.append(el('p', { class: 'sidebar-empty', text: 'Sin notas en este documento.' }));
      return;
    }
    for (const n of notes) {
      const row = el(
        'div',
        { class: 'note-row' },
        el(
          'div',
          { class: 'note-head' },
          n.page
            ? el('button', {
                class: 'note-page',
                text: `Pág. ${n.page}`,
                title: 'Ir a la página',
                onclick: () => this.gotoPage(n.page ?? 1),
              })
            : null,
          el('span', { class: 'note-date', text: new Date(n.updated).toLocaleDateString('es-ES') }),
          el('button', {
            class: 'icon-btn',
            title: 'Editar nota',
            'aria-label': 'Editar nota',
            onclick: () => void this.editNote(n),
          }, icon('edit')),
          el('button', {
            class: 'icon-btn',
            title: 'Borrar nota',
            'aria-label': 'Borrar nota',
            onclick: () => this.vh.removeNote(n.id),
          }, icon('close')),
        ),
        el('p', { class: 'note-text', text: n.text }),
      );
      if (n.page) {
        // Toda la fila lleva a la página de la nota (salvo los botones).
        row.addEventListener('click', (e) => {
          if ((e.target as HTMLElement).closest('.icon-btn')) return;
          this.gotoPage(n.page ?? 1);
        });
      }
      list.append(row);
    }
  }

  /* ---------- Estado ---------- */

  private updateStatus(zoomPct?: number): void {
    const pct = zoomPct ?? Math.round(this.pdf.getZoom() * 100);
    this.pageInput.value = String(this.tab.page);
    this.pageTotal.textContent = `/ ${this.total || '—'}`;
    this.zoomLabel.textContent = `${pct}%`;
    this.vh.setStatus({
      left: `${this.name}`,
      right: `Página ${this.tab.page} / ${this.total || '—'} · ${pct}%`,
    });
  }

  saveState(): void {
    this.tab.scrollTop = this.pdf.getScrollTop();
    this.tab.rotation = this.pdf.getRotation();
    this.tab.zoom = this.pdf.getZoomMode();
    this.recordPosition();
  }

  /**
   * Restaura página, zoom y scroll al volver a mostrar la pestaña (Tarea 0).
   *
   * El elemento del visor se desatacha del DOM al cambiar de pestaña y el
   * scroll se pierde al reengancharlo; además el contenedor necesita su tamaño
   * real para recalcular los modos de ajuste. Por eso se restaura tras dos
   * frames, cuando la vista ya está visible y con layout.
   */
  restore(): void {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const zoom = this.tab.zoom as 'page-width' | 'page-fit' | number;
        if (zoom !== undefined && zoom !== null) this.pdf.setZoom(zoom);
        if (this.tab.scrollTop > 0) {
          // El scroll fino ya engloba la navegación: si además se llamara a
          // gotoPage, su scroll diferido pisaría esta posición.
          this.pdf.setScrollTop(this.tab.scrollTop);
        } else if (this.tab.page > 1) {
          this.pdf.gotoPage(this.tab.page);
        }
        // Las capas de anotaciones se recolocan con el zoom restaurado.
        this.annLayer?.render();
        this.updateStatus();
        // Las páginas se renderizan de forma perezosa y el scroll máximo crece:
        // se reaplica el scroll guardado hasta que «agarra» (con reintentos).
        if (this.tab.scrollTop > 0) {
          const target = this.tab.scrollTop;
          let attempts = 0;
          const reapply = (): void => {
            this.pdf.setScrollTop(target);
            attempts += 1;
            if (Math.abs(this.pdf.getScrollTop() - target) > 1 && attempts < 8) {
              setTimeout(reapply, 250);
            }
          };
          setTimeout(reapply, 150);
        }
      }),
    );
  }

  dispose(): void {
    this.saveState();
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.annLayer?.dispose();
    this.thumbs?.dispose();
    this.pdf.dispose();
    this.root.remove();
  }
}
