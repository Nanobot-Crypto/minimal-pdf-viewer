/** Vista Markdown: editor + previsualización con actualización en vivo. */

import type { MdMode, Tab } from '../core/types';
import type { ViewHost } from '../ui/host';
import { el, clear } from '../ui/dom';
import { icon } from '../ui/icons';
import { MdEditor } from './editor';
import { extractHeadings, renderMarkdown } from './preview';
import { exportHtmlTo, exportNameFor, exportPdfViaPrint, inlineLocalImages } from './export';
import { bridge } from '../core/bridge';
import type { NoteEntry } from '../core/notes';
import { textareaDialog } from '../ui/dialog';

export class MdDocView {
  private editor!: MdEditor;
  private preview!: HTMLElement;
  private root: HTMLElement;
  private toolbar!: HTMLElement;
  private mode: MdMode;
  private readOnly: boolean;
  private text: string;
  /** Último contenido guardado; `null` indica borrador restaurado sin guardar. */
  private savedText: string | null;
  private lastOutlineKey = '';

  constructor(
    host: HTMLElement,
    private fileId: string,
    private name: string,
    private tab: Tab,
    private vh: ViewHost,
    initialText: string,
  ) {
    this.mode = tab.mdMode ?? 'split';
    this.readOnly = false;
    this.text = initialText;
    this.savedText = tab.draft ? null : initialText;
    this.root = el('div', { class: 'doc doc-md' });
    host.append(this.root);

    this.toolbar = el('div', { class: 'md-toolbar' });
    const modes: { id: MdMode; label: string }[] = [
      { id: 'split', label: 'Dividir' },
      { id: 'edit', label: 'Editar' },
      { id: 'preview', label: 'Leer' },
    ];
    const seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Modo de vista' });
    for (const m of modes) {
      const b = el('button', {
        class: `seg-btn${this.mode === m.id ? ' active' : ''}`,
        'aria-pressed': this.mode === m.id ? 'true' : 'false',
        text: m.label,
        onclick: () => this.setMode(m.id),
      });
      b.dataset.mode = m.id;
      seg.append(b);
    }
    const spacer = el('div', { class: 'spacer' });
    const btnHtml = el(
      'button',
      { class: 'icon-btn', title: 'Exportar a HTML', 'aria-label': 'Exportar a HTML', onclick: () => void this.exportHtml() },
      icon('export'),
    );
    const btnPdf = el(
      'button',
      { class: 'icon-btn', title: 'Exportar a PDF (impresión)', 'aria-label': 'Exportar a PDF', onclick: () => void this.exportPdf() },
      icon('print'),
    );
    const btnReadOnly = el(
      'button',
      {
        class: 'icon-btn',
        title: 'Alternar solo lectura',
        'aria-label': 'Alternar solo lectura',
        onclick: () => this.toggleReadOnly(),
      },
      icon('eye'),
    );
    this.toolbar.append(seg, spacer, btnReadOnly, btnHtml, btnPdf);

    const panes = el('div', { class: 'md-panes' });
    const editorHost = el('div', { class: 'md-editor-host' });
    this.preview = el('article', { class: 'md-preview', 'aria-label': 'Previsualización' });
    panes.append(editorHost, this.preview);
    this.root.append(this.toolbar, panes);

    this.editor = new MdEditor(
      editorHost,
      this.text,
      {
        onDocChanged: (text, cursor) => this.handleDocChanged(text, cursor),
        onCursorChanged: (cursor) => {
          this.tab.cursor = cursor;
        },
      },
      this.vh.currentTheme(),
    );
    this.editor.setCursor(this.tab.cursor);
    this.bindScrollSync();
    this.applyMode();
    this.renderPreview();
    this.updateStatus();
    this.buildSidebar();
  }

  /** Cambios del editor: estado de la pestaña, borrador de recuperación y vista. */
  private handleDocChanged(text: string, cursor: number): void {
    this.text = text;
    this.tab.draft = text;
    this.tab.dirty = this.savedText === null ? true : text !== this.savedText;
    this.tab.cursor = cursor;
    this.renderPreview();
    this.updateStatus();
    this.vh.tabsChanged();
    this.vh.stateChanged();
    // Borrador de recuperación (autoguardado): nunca toca el archivo original.
    this.vh.mdDraftChanged(this.fileId, this.name, text);
    this.refreshOutlineIfChanged();
  }

  /** Sincroniza el desplazamiento del editor con la previsualización. */
  private bindScrollSync(): void {
    const scroller = this.root.querySelector('.cm-scroller');
    if (!(scroller instanceof HTMLElement)) return;
    scroller.addEventListener(
      'scroll',
      () => {
        if (this.mode === 'edit') return;
        const max = scroller.scrollHeight - scroller.clientHeight;
        if (max <= 0) return;
        const ratio = scroller.scrollTop / max;
        const pmax = this.preview.scrollHeight - this.preview.clientHeight;
        if (pmax > 0) this.preview.scrollTop = ratio * pmax;
      },
      { passive: true },
    );
  }

  private renderPreview(): void {
    const html = renderMarkdown(this.text);
    this.preview.innerHTML = html;
    void inlineLocalImages(this.preview.innerHTML, this.fileId).then((withImages) => {
      // Solo se reemplaza si el contenido no ha cambiado mientras tanto.
      if (renderMarkdown(this.text) === html) this.preview.innerHTML = withImages;
    });
  }

  /** Cambia el modo de edición (usado también al alternar solo lectura). */
  setMode(mode: MdMode): void {
    this.mode = mode;
    this.tab.mdMode = mode;
    this.applyMode();
    this.vh.stateChanged();
    for (const b of this.toolbar.querySelectorAll('.seg-btn')) {
      const active = (b as HTMLElement).dataset.mode === mode;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  }

  getMode(): MdMode {
    return this.mode;
  }

  get element(): HTMLElement {
    return this.root;
  }

  /** Rehace el contenido del panel lateral (al activar la pestaña). */
  refreshSidebar(): void {
    this.buildSidebar();
  }

  /** Actualiza la referencia de archivo tras «Guardar como». */
  setFileRef(fileId: string, name: string): void {
    // El contenido ya está guardado en el destino: el borrador de recuperación
    // del archivo anterior ya no aporta nada.
    this.vh.clearDraft(this.fileId);
    this.vh.rekeyNotes(this.fileId, fileId, name);
    this.fileId = fileId;
    this.name = name;
    this.renderPreview();
  }

  private applyMode(): void {
    this.root.dataset.mode = this.mode;
    if (this.mode !== 'preview') this.editor.focus();
  }

  toggleReadOnly(): void {
    this.readOnly = !this.readOnly;
    this.editor.destroy();
    const host = this.root.querySelector('.md-editor-host') as HTMLElement;
    clear(host);
    this.editor = new MdEditor(
      host,
      this.text,
      {
        onDocChanged: (text, cursor) => this.handleDocChanged(text, cursor),
        onCursorChanged: (cursor) => {
          this.tab.cursor = cursor;
        },
      },
      this.vh.currentTheme(),
      this.readOnly,
    );
    this.bindScrollSync();
    this.vh.setStatus({ right: this.readOnly ? 'Solo lectura' : 'Editable' });
    this.vh.stateChanged();
  }

  isReadOnly(): boolean {
    return this.readOnly;
  }

  /* ---------- Búsqueda dentro del editor ---------- */

  openFind(): void {
    if (this.mode === 'preview') this.setMode('split');
    this.editor.openSearch();
  }

  /* ---------- Guardado y exportación ---------- */

  getText(): string {
    return this.text;
  }

  markClean(): void {
    this.savedText = this.text;
    this.tab.dirty = false;
    this.tab.draft = undefined;
    // El archivo ya contiene este texto: el borrador de recuperación sobra.
    this.vh.clearDraft(this.fileId);
    this.updateStatus();
    this.vh.tabsChanged();
  }

  async exportHtml(): Promise<void> {
    const target = await bridge.resolveSaveTarget(exportNameFor(this.fileId, 'html'), [
      { name: 'HTML', extensions: ['html'] },
    ]);
    if (!target) return;
    let overwrite = false;
    if (await bridge.exists(target.id)) {
      overwrite = await this.vh.confirm(
        'El archivo ya existe',
        `«${target.name}» ya existe. ¿Quieres sobrescribirlo?`,
        true,
      );
      if (!overwrite) return;
    }
    const res = await exportHtmlTo(target.id, this.name, this.text, overwrite);
    if (res === 'ok') this.vh.setStatus({ right: `Exportado a ${target.name}` });
  }

  async exportPdf(): Promise<void> {
    const ok = exportPdfViaPrint(this.name.replace(/\.(md|markdown|mdown)$/i, ''), this.text);
    if (ok === 'ok') {
      this.vh.setStatus({ right: 'Diálogo de impresión abierto: elige «Guardar como PDF»' });
    }
  }

  /* ---------- Panel lateral ---------- */

  private buildSidebar(): void {
    this.vh.sidebarShowAll({
      'md-outline': (host) => {
        clear(host);
        const headings = extractHeadings(this.text);
        if (!headings.length) {
          host.append(el('p', { class: 'sidebar-empty', text: 'Sin encabezados en este documento.' }));
          return;
        }
        const wrap = el('div', { class: 'outline-tree' });
        for (const h of headings) {
          const row = el(
            'button',
            { class: 'outline-row', style: `padding-left:${10 + (h.level - 1) * 12}px` },
            el('span', { class: 'outline-title', text: h.text || '(sin título)' }),
          );
          row.addEventListener('click', () => this.jumpToHeading(h));
          wrap.append(row);
        }
        host.append(wrap);
      },
      'md-notes': (host) => {
        clear(host);
        host.append(this.renderNotes());
      },
    });
    this.lastOutlineKey = this.outlineKey();
  }

  private outlineKey(): string {
    return extractHeadings(this.text)
      .map((h) => `${h.level}:${h.text}:${h.line}`)
      .join('|');
  }

  /** Solo repinta el panel si el esquema cambió de verdad (al escribir). */
  private refreshOutlineIfChanged(): void {
    const key = this.outlineKey();
    if (key === this.lastOutlineKey) return;
    this.buildSidebar();
  }

  /* ---------- Notas ---------- */

  /** Diálogo para añadir una nota del documento. */
  async addNote(): Promise<void> {
    const text = await textareaDialog({
      title: `Nota · ${this.name}`,
      message: 'Se guarda con Vela; el documento Markdown no se modifica.',
      input: { placeholder: 'Escribe la nota…' },
      confirmText: 'Guardar nota',
    });
    if (text === null) return;
    this.vh.addNote({ docId: this.fileId, docName: this.name, kind: 'md', text });
    this.vh.setStatus({ right: 'Nota añadida' });
  }

  private async editNote(note: NoteEntry): Promise<void> {
    const text = await textareaDialog({
      title: 'Editar nota',
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
      text: 'Añadir nota',
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
      list.append(row);
    }
  }

  /**
   * Salta a un encabezado manteniendo el modo de vista actual: solo desplaza.
   * (Antes forzaba la vista dividida, que no era lo pedido.)
   */
  private jumpToHeading(h: { level: number; text: string; line: number }): void {
    if (this.mode === 'preview') {
      this.scrollPreviewToHeading(h);
      return;
    }
    const lines = this.text.split('\n');
    const pos = lines.slice(0, h.line).join('\n').length + (h.line > 0 ? 1 : 0);
    this.editor.setCursor(pos);
    this.editor.focus();
    if (this.mode === 'split') {
      // Tras el scroll del editor (y su sincronización), alineamos la vista previa.
      requestAnimationFrame(() => this.scrollPreviewToHeading(h));
    }
  }

  /** Desplaza la previsualización al encabezado indicado. */
  private scrollPreviewToHeading(h: { level: number; text: string; line: number }): void {
    const norm = (s: string | null): string => (s ?? '').replace(/\s+/g, ' ').trim();
    const heads = Array.from(this.preview.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6'));
    const target = heads.find((el) => norm(el.textContent) === h.text);
    if (!target) {
      // Respaldo (encabezados setext, textos con marcas): proporción del documento.
      const total = Math.max(1, this.text.split('\n').length);
      const ratio = Math.min(1, Math.max(0, h.line / total));
      this.preview.scrollTop = ratio * (this.preview.scrollHeight - this.preview.clientHeight);
      return;
    }
    const top =
      target.getBoundingClientRect().top -
      this.preview.getBoundingClientRect().top +
      this.preview.scrollTop;
    this.preview.scrollTop = Math.max(0, top - 8);
  }

  /* ---------- Estado ---------- */

  private updateStatus(): void {
    const words = this.text.trim() ? this.text.trim().split(/\s+/).length : 0;
    this.vh.setStatus({
      left: `${this.name}${this.tab.dirty ? ' •' : ''}`,
      right: `${words} palabras · ${this.readOnly ? 'Solo lectura' : 'Editable'}`,
    });
  }

  setTheme(theme: 'light' | 'dark'): void {
    this.editor.setTheme(theme);
  }

  saveState(): void {
    this.tab.draft = this.text;
    this.tab.cursor = this.editor.getCursor();
    const scroller = this.root.querySelector('.cm-scroller');
    if (scroller instanceof HTMLElement) this.tab.mdEditorScroll = scroller.scrollTop;
    this.tab.mdPreviewScroll = this.preview.scrollTop;
    this.tab.mdMode = this.mode;
  }

  /**
   * Restaura scroll del editor y de la previsualización (y el cursor) al
   * volver a mostrar la pestaña (Tarea 0). El cursor se recupera sin
   * desplazar, y luego se reaplica el scroll guardado.
   */
  restore(): void {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (this.tab.cursor > 0) {
          const p = Math.min(this.tab.cursor, this.text.length);
          this.editor.setCursor(p);
        }
        const applyScroll = (): void => {
          const scroller = this.root.querySelector('.cm-scroller');
          if (scroller instanceof HTMLElement && this.tab.mdEditorScroll) {
            scroller.scrollTop = this.tab.mdEditorScroll;
          }
          if (this.tab.mdPreviewScroll) this.preview.scrollTop = this.tab.mdPreviewScroll;
        };
        applyScroll();
        // CodeMirror re-mide al volver a ser visible: se reaplica con reintentos
        // para no quedarse corto si el máximo de scroll cambió.
        let attempts = 0;
        const retry = (): void => {
          applyScroll();
          attempts += 1;
          const sc = this.root.querySelector('.cm-scroller');
          const want = this.tab.mdEditorScroll ?? 0;
          const got = sc instanceof HTMLElement ? sc.scrollTop : 0;
          if (want > 0 && Math.abs(got - want) > 1 && attempts < 8) setTimeout(retry, 250);
        };
        setTimeout(retry, 150);
      }),
    );
  }

  dispose(): void {
    this.saveState();
    this.editor.destroy();
    this.root.remove();
  }
}
