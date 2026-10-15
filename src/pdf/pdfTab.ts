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
import { filledCopyName, listFormFields, saveFilledPdf, type FormFieldInfo } from './forms';
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
    void this.initForms();
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

  dispose(): void {
    this.saveState();
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.thumbs?.dispose();
    this.pdf.dispose();
    this.root.remove();
  }
}
