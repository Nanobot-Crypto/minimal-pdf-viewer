/** Vista Markdown: editor + previsualización con actualización en vivo. */

import type { MdMode, Tab } from '../core/types';
import type { ViewHost } from '../ui/host';
import { el, clear } from '../ui/dom';
import { icon } from '../ui/icons';
import { MdEditor } from './editor';
import { extractHeadings, renderMarkdown } from './preview';
import { exportHtmlTo, exportNameFor, exportPdfViaPrint, inlineLocalImages } from './export';
import { bridge } from '../core/bridge';

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
        onDocChanged: (text, cursor) => {
          this.text = text;
          this.tab.draft = text;
          this.tab.dirty = this.savedText === null ? true : text !== this.savedText;
          this.tab.cursor = cursor;
          this.renderPreview();
          this.updateStatus();
          this.vh.tabsChanged();
          this.vh.stateChanged();
        },
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
        onDocChanged: (text, cursor) => {
          this.text = text;
          this.tab.draft = text;
          this.tab.dirty = this.savedText === null ? true : text !== this.savedText;
          this.tab.cursor = cursor;
          this.renderPreview();
          this.updateStatus();
          this.vh.tabsChanged();
          this.vh.stateChanged();
        },
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
    this.vh.sidebarShow('md-outline', (host) => {
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
        row.addEventListener('click', () => {
          const lines = this.text.split('\n');
          const pos = lines.slice(0, h.line).join('\n').length + (h.line > 0 ? 1 : 0);
          if (this.mode === 'preview') this.setMode('split');
          this.editor.setCursor(pos);
          this.editor.focus();
        });
        wrap.append(row);
      }
      host.append(wrap);
    });
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
  }

  dispose(): void {
    this.saveState();
    this.editor.destroy();
    this.root.remove();
  }
}
