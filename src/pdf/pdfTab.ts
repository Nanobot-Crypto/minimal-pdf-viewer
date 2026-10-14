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
    );
    this.root.append(this.toolbar);

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
        this.vh.stateChanged();
      },
      onZoomChange: (pct) => {
        this.tab.zoom = this.pdf.getZoom();
        this.updateStatus(pct);
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
    await this.pdf.load(bytes, {
      initialPage: this.tab.page,
      zoom: this.tab.zoom as 'page-width' | 'page-fit' | number,
      rotation: this.tab.rotation,
    });
    if (this.tab.scrollTop > 0) this.pdf.setScrollTop(this.tab.scrollTop);
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
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.hideToolbar(), 2600);
  }

  private hideToolbar(): void {
    this.toolbar.classList.remove('visible');
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    setTimeout(() => {
      if (!this.toolbar.classList.contains('visible')) this.toolbar.hidden = true;
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

  zoomIn(): void {
    this.pdf.zoomIn();
  }

  zoomOut(): void {
    this.pdf.zoomOut();
  }

  rotate(): void {
    this.pdf.rotate();
    this.tab.rotation = this.pdf.getRotation();
    this.vh.stateChanged();
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
      } else {
        host.append(this.renderBookmarks());
      }
    };

    this.vh.sidebarShow('thumbs', (h) => render(h, 'thumbs'));
    this.vh.sidebarShow('outline', (h) => render(h, 'outline'));
    this.vh.sidebarShow('bookmarks', (h) => render(h, 'bookmarks'));
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
    this.tab.zoom = this.pdf.getZoom();
  }

  dispose(): void {
    this.saveState();
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.thumbs?.dispose();
    this.pdf.dispose();
    this.root.remove();
  }
}
