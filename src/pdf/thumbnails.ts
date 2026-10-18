/** Miniaturas del PDF: renderizado perezoso, bajo consumo de memoria. */

import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

/** Ancho de referencia de cada miniatura. */
const THUMB_WIDTH = 116;
/** Ancho mínimo si el panel lateral es muy estrecho. */
const MIN_THUMB_WIDTH = 48;
/** Espacio que ocupa la celda alrededor del canvas (padding + borde + holgura). */
const CELL_MARGIN = 12;

export class PdfThumbnails {
  private doc: PDFDocumentProxy | null = null;
  private host: HTMLElement | null = null;
  private observer: IntersectionObserver | null = null;
  /** Vigila el tamaño real del panel (visible, ancho, redimensionado). */
  private resizeObserver: ResizeObserver | null = null;
  /** Páginas ya pintadas en el canvas vivo. */
  private rendered = new Set<number>();
  /** Páginas con un render en curso (página → generación que lo lanzó). */
  private painting = new Map<number, number>();
  /** Páginas pedidas con el panel oculto o sin ancho: se pintan al mostrarse. */
  private pending = new Set<number>();
  /** Páginas visibles en el scroll del panel (las demás se pintan perezosas). */
  private visible = new Set<number>();
  /** Página activa: siempre se mantiene pintada. */
  private current = 1;
  /** Generación del DOM: invalida renders que apunten a un host reconstruido. */
  private generation = 0;
  /** Ancho CSS con el que se generan las miniaturas actuales. */
  private thumbWidth = THUMB_WIDTH;

  constructor(private onPick: (page: number) => void) {}

  /** Monta el contenedor (el panel lateral puede rehacer su contenido). */
  mount(host: HTMLElement): void {
    this.host = host;
    host.classList.add('thumbs');
    this.observeLayout(host);
    this.rebuild();
  }

  setDocument(doc: PDFDocumentProxy): void {
    this.doc = doc;
    this.current = 1;
    this.rebuild();
  }

  setCurrent(page: number): void {
    this.current = page;
    if (!this.host) return;
    const prev = this.host.querySelector('.thumb-cell.active');
    prev?.classList.remove('active');
    const cell = this.host.querySelector(`.thumb-cell[data-page="${page}"]`);
    if (cell) {
      cell.classList.add('active');
      (cell as HTMLElement).scrollIntoView({ block: 'nearest' });
    }
    void this.renderThumb(page);
  }

  /**
   * Vigila el tamaño real del panel.
   *
   * Las miniaturas solo se renderizan cuando el panel está visible y tiene
   * ancho: con `display:none` (panel lateral cerrado o sección oculta) el
   * tamaño es cero y el render sale con medidas imposibles (canvas apaisado
   * en blanco, proporciones rotas). Al mostrarse o redimensionarse se repinta
   * con la medida real.
   */
  private observeLayout(host: HTMLElement): void {
    this.resizeObserver?.disconnect();
    if (typeof ResizeObserver === 'undefined') return;
    this.resizeObserver = new ResizeObserver(() => {
      const width = this.measureThumbWidth();
      if (width !== this.thumbWidth) {
        // El panel cambió de ancho: las miniaturas se rehacen a la medida nueva.
        this.thumbWidth = width;
        this.invalidateRendered();
        return;
      }
      const ready = this.isHostReady();
      if (ready) this.flushPending();
    });
    this.resizeObserver.observe(host);
  }

  /** ¿El panel está montado, visible y con ancho real? */
  private isHostReady(): boolean {
    const host = this.host;
    if (!host || !host.isConnected) return false;
    // display:none no produce cajas ni ancho: nada que renderizar todavía.
    return host.getClientRects().length > 0 && host.clientWidth > 0;
  }

  /** Ancho de miniatura según el ancho real del panel (nunca desborda la celda). */
  private measureThumbWidth(): number {
    const avail = this.host?.clientWidth ?? 0;
    if (avail <= 0) return THUMB_WIDTH;
    return Math.max(MIN_THUMB_WIDTH, Math.min(THUMB_WIDTH, avail - CELL_MARGIN));
  }

  /** Descarta lo pintado (medida nueva, canvas nuevos) y repinta lo visible. */
  private invalidateRendered(): void {
    this.generation++;
    this.rendered.clear();
    this.painting.clear();
    this.flushPending();
  }

  private rebuild(): void {
    // Canvases nuevos: lo pintado antes ya no sirve (antes esta huella dejaba
    // las miniaturas en blanco para siempre al cambiar de panel).
    this.generation++;
    this.observer?.disconnect();
    this.observer = null;
    this.rendered.clear();
    this.painting.clear();
    this.pending.clear();
    this.visible.clear();
    if (!this.host || !this.doc || !this.host.isConnected) return;
    const doc = this.doc;
    this.thumbWidth = this.measureThumbWidth();
    this.host.innerHTML = '';
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const page = Number((e.target as HTMLElement).dataset.page);
          if (e.isIntersecting) {
            this.visible.add(page);
            void this.renderThumb(page);
          } else {
            this.visible.delete(page);
          }
        }
      },
      { root: this.host, rootMargin: '300px 0px' },
    );
    for (let p = 1; p <= doc.numPages; p++) {
      const cell = document.createElement('button');
      cell.className = 'thumb-cell';
      cell.dataset.page = String(p);
      cell.setAttribute('aria-label', `Página ${p}`);
      const canvas = document.createElement('canvas');
      canvas.className = 'thumb-canvas';
      const label = document.createElement('span');
      label.className = 'thumb-label';
      label.textContent = String(p);
      cell.append(canvas, label);
      cell.addEventListener('click', () => this.onPick(p));
      this.host.append(cell);
      this.observer.observe(cell);
    }
    this.setCurrent(this.current);
  }

  /** Repinta la activa, las visibles y las pedidas mientras el panel estaba oculto. */
  private flushPending(): void {
    const pages = new Set<number>([...this.visible, ...this.pending, this.current]);
    this.pending.clear();
    for (const p of pages) void this.renderThumb(p);
  }

  /**
   * Pinta la miniatura de una página en su canvas.
   *
   * Solo se marca como pintada tras completarse el render sobre un canvas que
   * sigue en el DOM; si el panel se reconstruye a mitad de camino, la página
   * queda pendiente y el siguiente ciclo la vuelve a intentar (antes, la página
   * podía quedarse en blanco para siempre).
   */
  private async renderThumb(pageNumber: number): Promise<void> {
    if (!this.doc || this.rendered.has(pageNumber)) return;
    if (this.painting.get(pageNumber) === this.generation) return;
    // Comprobación en vivo: solo se pinta con el panel visible y con ancho
    // real (con display:none el tamaño es cero y el render sale roto).
    if (!this.isHostReady()) {
      this.pending.add(pageNumber);
      return;
    }
    const cell = this.host?.querySelector(`.thumb-cell[data-page="${pageNumber}"] canvas`);
    if (!(cell instanceof HTMLCanvasElement)) return;
    const generation = this.generation;
    this.painting.set(pageNumber, generation);
    try {
      const page: PDFPageProxy = await this.doc.getPage(pageNumber);
      if (generation !== this.generation || !cell.isConnected) return;
      const base = page.getViewport({ scale: 1 });
      const scale = this.thumbWidth / base.width;
      const viewport = page.getViewport({ scale });
      // HiDPI: el backing store se multiplica por la densidad de píxel y el
      // render se escala en consecuencia (si no, la página queda diminuta en
      // la esquina superior izquierda del canvas).
      const ratio = Math.min(Math.max(window.devicePixelRatio || 1, 1), 3);
      cell.width = Math.max(1, Math.floor(viewport.width * ratio));
      cell.height = Math.max(1, Math.floor(viewport.height * ratio));
      cell.style.width = `${Math.floor(viewport.width)}px`;
      cell.style.height = `${Math.floor(viewport.height)}px`;
      const ctx = cell.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, cell.width, cell.height);
      await page.render({
        canvasContext: ctx,
        viewport,
        transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
      }).promise;
      if (generation === this.generation && cell.isConnected) this.rendered.add(pageNumber);
    } catch {
      // Fallo transitorio: sin marcar como pintada, se reintentará.
      this.pending.add(pageNumber);
    } finally {
      if (this.painting.get(pageNumber) === generation) this.painting.delete(pageNumber);
    }
  }

  dispose(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.doc = null;
    this.rendered.clear();
    this.painting.clear();
    this.pending.clear();
    this.visible.clear();
    if (this.host) this.host.innerHTML = '';
    this.host = null;
  }
}
