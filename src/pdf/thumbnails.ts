/** Miniaturas del PDF: renderizado perezoso, bajo consumo de memoria. */

import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

const THUMB_WIDTH = 116;

export class PdfThumbnails {
  private doc: PDFDocumentProxy | null = null;
  private host: HTMLElement | null = null;
  private observer: IntersectionObserver | null = null;
  private rendered = new Set<number>();

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

  private async renderThumb(pageNumber: number): Promise<void> {
    if (!this.doc || this.rendered.has(pageNumber)) return;
    this.rendered.add(pageNumber);
    const cell = this.host?.querySelector(`.thumb-cell[data-page="${pageNumber}"] canvas`);
    if (!(cell instanceof HTMLCanvasElement)) return;
    try {
      const page: PDFPageProxy = await this.doc.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const scale = THUMB_WIDTH / base.width;
      const viewport = page.getViewport({ scale });
      const ratio = window.devicePixelRatio || 1;
      cell.width = Math.floor(viewport.width * ratio);
      cell.height = Math.floor(viewport.height * ratio);
      cell.style.width = `${Math.floor(viewport.width)}px`;
      cell.style.height = `${Math.floor(viewport.height)}px`;
      const ctx = cell.getContext('2d');
      if (!ctx) return;
      await page.render({ canvasContext: ctx, viewport }).promise;
    } catch {
      this.rendered.delete(pageNumber);
    }
  }

  dispose(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.doc = null;
    if (this.host) this.host.innerHTML = '';
    this.host = null;
  }
}
