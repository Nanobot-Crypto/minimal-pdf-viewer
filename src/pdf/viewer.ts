/** Visor PDF basado en pdf.js (motor estable, sin servicios externos). */

import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { clampPage } from '../core/docstore';
import {
  EventBus,
  PDFFindController,
  PDFLinkService,
  PDFViewer,
} from 'pdfjs-dist/web/pdf_viewer.mjs';
import 'pdfjs-dist/web/pdf_viewer.css';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface PdfSearchStats {
  current: number;
  total: number;
}

export interface PdfViewCallbacks {
  onReady(total: number): void;
  onPageChange(page: number, total: number): void;
  onZoomChange(scalePercent: number, label: string): void;
  onSearchStats(stats: PdfSearchStats): void;
  onPasswordNeeded(updatePassword: (pw: string) => void): void;
  onError(message: string): void;
}

export type ZoomMode = 'page-width' | 'page-fit' | number;

interface FindStateEvent {
  state?: number;
  matchesCount?: { current: number; total: number };
}
interface FindMatchesEvent {
  matchesCount?: { current: number; total: number };
}

export class PdfView {
  private doc: PDFDocumentProxy | null = null;
  private viewer!: PDFViewer;
  private eventBus: InstanceType<typeof EventBus>;
  private linkService: InstanceType<typeof PDFLinkService>;
  private findController: InstanceType<typeof PDFFindController>;
  private container!: HTMLDivElement;
  private total = 0;
  private searchQuery = '';
  /** Último modo de ajuste solicitado (página/ancho/escala fija). */
  private zoomMode: ZoomMode = 'page-width';

  constructor(private host: HTMLElement, private cb: PdfViewCallbacks) {
    this.eventBus = new EventBus();
    this.linkService = new PDFLinkService({ eventBus: this.eventBus });
    this.findController = new PDFFindController({
      linkService: this.linkService,
      eventBus: this.eventBus,
    });

    const viewerEl = document.createElement('div');
    viewerEl.className = 'pdfViewer';
    this.container = document.createElement('div');
    this.container.className = 'pdf-viewer-container';
    this.container.tabIndex = 0;
    this.container.append(viewerEl);
    this.host.append(this.container);
    this.viewer = new PDFViewer({
      container: this.container,
      viewer: viewerEl,
      eventBus: this.eventBus,
      linkService: this.linkService,
      findController: this.findController,
      textLayerMode: 1,
      removePageBorders: true,
    });
    this.linkService.setViewer(this.viewer);

    this.eventBus.on('pagesinit', () => {
      // El documento está listo para paginar.
    });
    this.eventBus.on('pagechanging', (e: { pageNumber: number }) => {
      this.cb.onPageChange(e.pageNumber, this.total);
    });
    this.eventBus.on('scalechanging', (e: { scale: number; preset?: string | null }) => {
      this.cb.onZoomChange(Math.round(e.scale * 100), e.preset ?? `${Math.round(e.scale * 100)}%`);
    });
    this.eventBus.on('updatefindmatchescount', (e: FindMatchesEvent) => {
      const m = e.matchesCount ?? { current: 0, total: 0 };
      this.cb.onSearchStats({ current: m.current, total: m.total });
    });
    this.eventBus.on('updatefindcontrolstate', (e: FindStateEvent) => {
      if (e.matchesCount) this.cb.onSearchStats({ current: e.matchesCount.current, total: e.matchesCount.total });
    });
  }

  async load(
    bytes: Uint8Array,
    opts: { initialPage?: number; zoom?: ZoomMode; rotation?: number } = {},
  ): Promise<void> {
    try {
      const task = pdfjs.getDocument({
        data: bytes,
        // No se envía nada a la red: todo el procesado es local.
        isEvalSupported: false,
      });
      task.onPassword = (updatePassword: (pw: string) => void) => {
        this.cb.onPasswordNeeded(updatePassword);
      };
      task.onProgress = () => {
        /* progreso de carga: el estado lo gestiona la app */
      };
      this.doc = await task.promise;
      this.total = this.doc.numPages;
      this.viewer.setDocument(this.doc);
      this.linkService.setDocument(this.doc, null);
      this.findController.setDocument(this.doc);
      await this.viewer.firstPagePromise;
      if (opts.rotation) this.viewer.pagesRotation = opts.rotation;
      this.setZoom(opts.zoom ?? 'page-width');
      if (opts.initialPage && opts.initialPage > 1) {
        await this.viewer.onePageRendered;
        this.gotoPage(opts.initialPage);
      }
      this.cb.onReady(this.total);
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err);
      const name = (err as Error)?.name ?? '';
      if (name === 'PasswordException') {
        this.cb.onError('Documento protegido: se necesita la contraseña.');
      } else {
        this.cb.onError(`No se pudo abrir el PDF: ${msg}`);
      }
    }
  }

  getDocument(): PDFDocumentProxy | null {
    return this.doc;
  }

  /**
   * Geometría de una página (índice 0-based) para las anotaciones:
   * elemento DOM y transformaciones viewport ⇄ espacio PDF.
   */
  getPageGeom(pageIndex: number): {
    element: HTMLElement;
    toPdf: (x: number, y: number) => [number, number];
    toViewport: (x: number, y: number) => [number, number];
  } | null {
    const pv = this.viewer.getPageView?.(pageIndex) as
      | { div?: HTMLElement; viewport?: { convertToPdfPoint(x: number, y: number): number[]; convertToViewportPoint(x: number, y: number): number[] } }
      | undefined;
    if (!pv?.div || !pv.viewport) return null;
    const vp = pv.viewport;
    return {
      element: pv.div,
      toPdf: (x, y) => {
        const p = vp.convertToPdfPoint(x, y);
        return [p[0], p[1]];
      },
      toViewport: (x, y) => {
        const p = vp.convertToViewportPoint(x, y);
        return [p[0], p[1]];
      },
    };
  }

  getPage(): number {
    return this.viewer.currentPageNumber;
  }

  getTotal(): number {
    return this.total;
  }

  gotoPage(page: number): void {
    // Si el documento cambió (menos páginas), la página se recorta al total
    // real: la navegación nunca falla por una posición guardada desfasada.
    const n = clampPage(page, this.total || 1);
    this.viewer.scrollPageIntoView({ pageNumber: n });
  }

  nextPage(): void {
    this.gotoPage(this.getPage() + 1);
  }

  prevPage(): void {
    this.gotoPage(this.getPage() - 1);
  }

  setZoom(mode: ZoomMode): void {
    this.zoomMode = mode;
    if (typeof mode === 'number') this.viewer.currentScale = mode;
    else this.viewer.currentScaleValue = mode;
  }

  /** Modo de ajuste vigente: 'page-width', 'page-fit' o una escala fija. */
  getZoomMode(): ZoomMode {
    return this.zoomMode;
  }

  getZoom(): number {
    return this.viewer.currentScale;
  }

  zoomIn(): void {
    this.setZoom(Math.min(5, this.viewer.currentScale * 1.15));
  }

  zoomOut(): void {
    this.setZoom(Math.max(0.15, this.viewer.currentScale / 1.15));
  }

  /**
   * Zoom multiplicativo (Ctrl+rueda o pellizco del trackpad) sobre el
   * documento, con los mismos límites que el zoom por botones.
   */
  zoomBy(factor: number): void {
    const next = Math.min(5, Math.max(0.15, this.viewer.currentScale * factor));
    if (next !== this.viewer.currentScale) this.setZoom(next);
  }

  rotate(): void {
    this.viewer.pagesRotation = (this.viewer.pagesRotation + 90) % 360;
  }

  getRotation(): number {
    return this.viewer.pagesRotation;
  }

  /** Búsqueda de texto sobre la capa de texto de pdf.js. */
  startSearch(query: string): void {
    this.searchQuery = query;
    this.eventBus.dispatch('find', {
      source: this,
      type: '',
      query,
      caseSensitive: false,
      entireWord: false,
      highlightAll: true,
      findPrevious: false,
      matchDiacritics: false,
    });
  }

  findNext(): void {
    if (!this.searchQuery) return;
    this.eventBus.dispatch('find', {
      source: this,
      type: 'again',
      query: this.searchQuery,
      caseSensitive: false,
      entireWord: false,
      highlightAll: true,
      findPrevious: false,
      matchDiacritics: false,
    });
  }

  findPrev(): void {
    if (!this.searchQuery) return;
    this.eventBus.dispatch('find', {
      source: this,
      type: 'again',
      query: this.searchQuery,
      caseSensitive: false,
      entireWord: false,
      highlightAll: true,
      findPrevious: true,
      matchDiacritics: false,
    });
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.eventBus.dispatch('find', {
      source: this,
      type: 'findbarclose',
      query: '',
      caseSensitive: false,
      entireWord: false,
      highlightAll: false,
      findPrevious: false,
      matchDiacritics: false,
    });
    this.cb.onSearchStats({ current: 0, total: 0 });
  }

  getScrollTop(): number {
    return this.container.scrollTop;
  }

  setScrollTop(v: number): void {
    this.container.scrollTop = v;
  }

  focus(): void {
    this.container.focus();
  }

  dispose(): void {
    try {
      this.doc?.destroy();
    } catch {
      /* documento ya liberado */
    }
    this.doc = null;
    this.container.remove();
  }
}
