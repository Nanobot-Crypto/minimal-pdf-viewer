/** Miniaturas del PDF: renderizado perezoso, bajo consumo de memoria. */

import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

const THUMB_WIDTH = 116;

export class PdfThumbnails {
  private doc: PDFDocumentProxy | null = null;
  private host: HTMLElement | null = null;
  private observer: IntersectionObserver | null = null;
  /** Páginas ya pintadas en el canvas vivo. */
  private rendered = new Set<number>();
  /** Páginas con un render en curso (evita pintados duplicados). */
  private painting = new Set<number>();
  /** Generación del DOM: invalida renders que apunten a un host reconstruido. */
  private generation = 0;

  constructor(private onPick: (page: number) => void) {}

  /** Monta el contenedor (el panel lateral puede rehacer su contenido). */
  mount(host: HTMLElement): void {
    this.host = host;
    host.classList.add('thumbs');
    this.rebuild();
  }

  setDocument(doc: PDFDocumentProxy): void {
    this.doc = doc;
    this.rendered.clear();
    this.painting.clear();
    this.rebuild();
  }

  setCurrent(page: number): void {
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

  private rebuild(): void {
    if (!this.host || !this.doc) return;
    const doc = this.doc;
    this.generation++;
    this.observer?.disconnect();
    this.host.innerHTML = '';
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            const page = Number((e.target as HTMLElement).dataset.page);
            void this.renderThumb(page);
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
    this.setCurrent(1);
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
    if (!this.doc || this.rendered.has(pageNumber) || this.painting.has(pageNumber)) return;
    const cell = this.host?.querySelector(`.thumb-cell[data-page="${pageNumber}"] canvas`);
    if (!(cell instanceof HTMLCanvasElement)) return;
    const generation = this.generation;
    this.painting.add(pageNumber);
    try {
      const page: PDFPageProxy = await this.doc.getPage(pageNumber);
      if (generation !== this.generation || !cell.isConnected) return;
      const base = page.getViewport({ scale: 1 });
      const scale = THUMB_WIDTH / base.width;
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
    } finally {
      this.painting.delete(pageNumber);
    }
  }

  dispose(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.doc = null;
    this.rendered.clear();
    this.painting.clear();
    if (this.host) this.host.innerHTML = '';
    this.host = null;
  }
}
