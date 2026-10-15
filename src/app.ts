/** Aplicación Vela: shell, pestañas, comandos, sesión y coordinación. */

import { bridge, dirName, kindFromName, type Bridge } from './core/bridge';
import {
  StatePersistence,
  defaultState,
  parseState,
  pushRecent,
  sessionToTabs,
  tabsToSession,
  toggleFavorite as toggleFavoriteLogic,
} from './core/state';
import { createTab, findIndexByFile, moveTab, nextIndex, syncTabCounter } from './core/tabs';
import {
  addNote as addNoteLogic,
  notesFor,
  parseNotes,
  removeNote as removeNoteLogic,
  rekeyNotes as rekeyNotesLogic,
  serializeNotes,
  updateNote as updateNoteLogic,
  type NoteEntry,
  type NoteInput,
} from './core/notes';
import { GLOBAL_SHORTCUTS, resolveShortcut } from './core/shortcuts';
import type {
  DirEntryInfo,
  DocKind,
  FavoriteEntry,
  OpenFilter,
  PersistedState,
  PickedFile,
  Tab,
} from './core/types';
import type { ViewHost } from './ui/host';
import { CommandPalette, type Command } from './ui/palette';
import { applyTheme, watchSystemTheme, type ThemePref } from './ui/theme';
import { clear, el } from './ui/dom';
import { icon } from './ui/icons';
import { confirmDialog, infoDialog } from './ui/dialog';
import { showContextMenu } from './ui/contextMenu';
import { initTitlebar } from './ui/titlebar';
import { EmptyView, ErrorView, LoadingView, MissingView } from './ui/views';
import { PdfDocView } from './pdf/pdfTab';
import { MdDocView } from './md/mdTab';
import { printPdfInApp, printPdfWithSystem } from './pdf/print';

const DOC_FILTERS: OpenFilter[] = [
  { name: 'Documentos', extensions: ['pdf', 'md', 'markdown', 'mdown'] },
  { name: 'PDF', extensions: ['pdf'] },
  { name: 'Markdown', extensions: ['md', 'markdown', 'mdown'] },
];
const MD_FILTERS: OpenFilter[] = [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown'] }];

const TYPING_ALLOWED = new Set([
  'palette.open',
  'doc.save',
  'doc.saveAs',
  'doc.find',
  'tab.close',
  'tab.next',
  'tab.prev',
  'view.theme',
  'tab.1',
  'tab.2',
  'tab.3',
  'tab.4',
  'tab.5',
  'tab.6',
  'tab.7',
  'tab.8',
  'tab.9',
]);

interface LoadedView {
  pdf?: PdfDocView;
  md?: MdDocView;
}

export class App implements ViewHost {
  private persisted: PersistedState = defaultState();
  private persistence: StatePersistence;
  private tabs: Tab[] = [];
  private activeIndex = 0;
  private loaded = new Map<string, LoadedView>();
  private sidebarSections = new Map<string, (host: HTMLElement) => void>();
  private sidebarViewId = 'auto';
  private palette: CommandPalette;
  private folder: { root: string; entries: DirEntryInfo[] } | null = null;
  /** Notas del usuario, indexadas por documento (almacén local). */
  private notes: NoteEntry[] = [];
  private notesTimer: ReturnType<typeof setTimeout> | null = null;

  // Elementos DOM
  private contentEl!: HTMLElement;
  private tabstripEl!: HTMLElement;
  private sidebarEl!: HTMLElement;
  private sidebarBodyEl!: HTMLElement;
  private sidebarTabsEl!: HTMLElement;
  private statusLeft!: HTMLElement;
  private statusRight!: HTMLElement;

  constructor(private b: Bridge = bridge) {
    this.persistence = new StatePersistence(() => this.snapshot());
    this.palette = new CommandPalette(() => this.commands());
  }

  /* -------------------------------------------------------------- */
  /* Arranque                                                        */
  /* -------------------------------------------------------------- */

  async start(): Promise<void> {
    this.contentEl = document.getElementById('content')!;
    this.tabstripEl = document.getElementById('tabstrip')!;
    this.sidebarEl = document.getElementById('sidebar')!;
    this.sidebarBodyEl = document.getElementById('sidebar-body')!;
    this.sidebarTabsEl = document.getElementById('sidebar-tabs')!;
    this.statusLeft = document.getElementById('status-left')!;
    this.statusRight = document.getElementById('status-right')!;

    const json = await this.b.loadState();
    this.persisted = parseState(json);
    this.notes = parseNotes(await this.b.loadNotes());
    applyTheme(this.persisted.theme);
    watchSystemTheme(() => {
      if (this.persisted.theme === 'system') applyTheme('system');
      this.refreshActiveTheme();
    });

    this.wireTopbar();
    this.wireShortcuts();
    this.wireDragAndDrop();
    this.wireTabStrip();
    void initTitlebar();

    document.getElementById('btn-theme')!.append(icon(this.themeIcon()));
    document.getElementById('btn-open')!.append(icon('open'));
    document.getElementById('btn-sidebar')!.append(icon('sidebar'));
    document.getElementById('btn-palette')!.append(icon('palette'));

    this.setSidebarOpen(this.persisted.sidebarOpen);

    // Restauración perezosa de la sesión anterior.
    const restored = sessionToTabs(this.persisted.session).filter((t) =>
      this.b.isRestorable(t.fileId) || t.draft,
    );
    if (restored.length) {
      syncTabCounter(restored);
      this.tabs = restored;
      this.activeIndex = Math.min(Math.max(0, this.persisted.activeIndex), restored.length - 1);
      this.renderTabs();
      void this.ensureLoaded(this.tabs[this.activeIndex]);
    } else {
      this.renderTabs();
      this.renderContent();
    }
    this.renderSidebar();

    // Documentos con los que se lanzó la aplicación (asociaciones de archivo).
    for (const p of await this.b.startupFiles()) {
      await this.openPicked(p);
    }

    window.addEventListener('beforeunload', () => {
      void this.persistence.flush();
      void this.flushNotes();
    });
  }

  /* -------------------------------------------------------------- */
  /* Cabecera y pestañas                                             */
  /* -------------------------------------------------------------- */

  private wireTopbar(): void {
    document.getElementById('btn-open')!.addEventListener('click', () => void this.openDocuments());
    document.getElementById('btn-sidebar')!.addEventListener('click', () => this.toggleSidebar());
    document.getElementById('btn-theme')!.addEventListener('click', () => this.toggleTheme());
    document.getElementById('btn-palette')!.addEventListener('click', () => this.palette.toggle());
  }

  private wireTabStrip(): void {
    this.tabstripEl.addEventListener('contextmenu', (e) => {
      const tabEl = (e.target as HTMLElement).closest('.tab');
      if (!tabEl) return;
      e.preventDefault();
      const index = Number((tabEl as HTMLElement).dataset.index);
      this.tabContextMenu(e.clientX, e.clientY, index);
    });
    this.tabstripEl.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).closest('.tab-close')) return;
      const tabEl = (e.target as HTMLElement).closest('.tab') as HTMLElement | null;
      if (tabEl && e.button === 1) {
        e.preventDefault();
        void this.requestClose(Number(tabEl.dataset.index));
      }
    });
  }

  renderTabs(): void {
    clear(this.tabstripEl);
    this.tabs.forEach((tab, i) => {
      const node = el(
        'div',
        {
          class: `tab${i === this.activeIndex ? ' active' : ''}${tab.dirty ? ' dirty' : ''}`,
          draggable: 'true',
          role: 'tab',
          'aria-selected': i === this.activeIndex ? 'true' : 'false',
          title: tab.fileId,
        },
        icon(tab.kind === 'pdf' ? 'pdf' : 'md'),
        el('span', { class: 'tab-name', text: tab.name }),
        el('span', { class: 'tab-dirty-dot', title: 'Cambios sin guardar' }),
        el(
          'button',
          {
            class: 'tab-close',
            title: 'Cerrar',
            'aria-label': `Cerrar ${tab.name}`,
            onclick: (e: Event) => {
              e.stopPropagation();
              void this.requestClose(i);
            },
          },
          icon('close'),
        ),
      );
      node.dataset.index = String(i);
      node.addEventListener('click', () => this.activateTab(i));
      node.addEventListener('dragstart', (e) => {
        (e as DragEvent).dataTransfer?.setData('text/vela-tab', String(i));
      });
      node.addEventListener('dragover', (e) => {
        if ((e as DragEvent).dataTransfer?.types.includes('text/vela-tab')) {
          e.preventDefault();
          node.classList.add('drag-over');
        }
      });
      node.addEventListener('dragleave', () => node.classList.remove('drag-over'));
      node.addEventListener('drop', (e) => {
        node.classList.remove('drag-over');
        const from = Number((e as DragEvent).dataTransfer?.getData('text/vela-tab'));
        if (Number.isFinite(from)) {
          this.tabs = moveTab(this.tabs, from, i);
          this.activeIndex = this.tabs.findIndex((t) => t.id === this.activeTab()?.id);
          this.renderTabs();
          this.stateChanged();
        }
      });
      this.tabstripEl.append(node);
    });
    if (!this.tabs.length) {
      this.tabstripEl.append(el('div', { class: 'tabstrip-empty', text: 'Sin documentos abiertos' }));
    }
  }

  private tabContextMenu(x: number, y: number, index: number): void {
    const tab = this.tabs[index];
    if (!tab) return;
    showContextMenu(x, y, [
      { label: 'Cerrar', action: () => void this.requestClose(index) },
      {
        label: 'Cerrar otros',
        disabled: this.tabs.length < 2,
        action: () => void this.closeOthers(index),
      },
      {
        label: 'Cerrar a la derecha',
        disabled: index >= this.tabs.length - 1,
        action: () => void this.closeRight(index),
      },
      { separator: true },
      {
        label: tab.kind === 'pdf' ? 'Marcar página como favorita' : 'Marcar como favorito',
        action: () => this.toggleFavoriteFor(tab),
      },
      {
        label: 'Imprimir',
        shortcut: 'Ctrl+P',
        action: () => void this.print(),
      },
      {
        label: 'Abrir con la aplicación del sistema',
        disabled: !this.b.isRestorable(tab.fileId),
        action: () => void this.b.openWithSystem(tab.fileId),
      },
      { separator: true },
      {
        label: 'Copiar ruta',
        disabled: !this.b.isRestorable(tab.fileId),
        action: () => void navigator.clipboard?.writeText(tab.fileId),
      },
    ]);
  }

  /* -------------------------------------------------------------- */
  /* Contenido                                                       */
  /* -------------------------------------------------------------- */

  private activeTab(): Tab | null {
    return this.tabs[this.activeIndex] ?? null;
  }

  renderContent(): void {
    clear(this.contentEl);
    const tab = this.activeTab();
    if (!tab) {
      this.contentEl.append(
        EmptyView({
          recents: this.persisted.recents,
          onOpenFile: () => void this.openDocuments(),
          onOpenFolder: () => void this.openFolder(),
          onOpenRecent: (r) => void this.openRecent(r),
        }),
      );
      this.setStatus({ left: 'Listo', right: '' });
      return;
    }
    if (tab.status === 'missing') {
      this.contentEl.append(
        MissingView({
          name: tab.name,
          onReopen: () => void this.reopenTab(tab),
        }),
      );
      return;
    }
    if (tab.status === 'error') {
      this.contentEl.append(
        ErrorView({
          title: 'No se pudo abrir el documento',
          message: tab.error ?? 'Error desconocido.',
          actionLabel: 'Intentar de nuevo',
          onAction: () => void this.reopenTab(tab),
        }),
      );
      return;
    }
    const view = this.loaded.get(tab.id);
    if (view?.pdf) {
      this.contentEl.append(view.pdf.element);
      view.pdf.refreshSidebar();
    } else if (view?.md) {
      this.contentEl.append(view.md.element);
      view.md.refreshSidebar();
    } else {
      this.contentEl.append(LoadingView(tab.name));
    }
  }

  /** Carga el documento de la pestaña si aún no está en memoria. */
  private async ensureLoaded(tab: Tab | null): Promise<void> {
    if (!tab) {
      this.renderContent();
      return;
    }
    if (this.loaded.has(tab.id)) {
      this.renderContent();
      return;
    }
    clear(this.contentEl);
    const loading = LoadingView(tab.name);
    this.contentEl.append(loading);
    try {
      if (tab.kind === 'pdf') {
        const bytes = await this.b.readBytes(tab.fileId);
        loading.remove();
        const view = new PdfDocView(this.contentEl, tab.fileId, tab.name, tab, this);
        this.loaded.set(tab.id, { pdf: view });
        await view.load(bytes);
        tab.status = 'ready';
        this.renderSidebar();
      } else {
        const text = await this.b.readText(tab.fileId);
        loading.remove();
        const view = new MdDocView(
          this.contentEl,
          tab.fileId,
          tab.name,
          tab,
          this,
          tab.draft ?? text,
        );
        this.loaded.set(tab.id, { md: view });
        tab.status = 'ready';
        this.renderSidebar();
      }
    } catch (err) {
      loading.remove();
      const msg = (err as Error)?.message ?? String(err);
      tab.status = /no disponible|not found|no such/i.test(msg) ? 'missing' : 'error';
      tab.error = msg;
      this.renderContent();
    }
    this.renderTabs();
    this.stateChanged();
  }

  activateTab(index: number): void {
    if (index < 0 || index >= this.tabs.length) return;
    const current = this.activeTab();
    if (current) {
      const v = this.loaded.get(current.id);
      v?.pdf?.saveState();
      v?.md?.saveState();
    }
    this.activeIndex = index;
    this.renderTabs();
    void this.ensureLoaded(this.tabs[index]);
  }

  async requestClose(index: number): Promise<void> {
    const tab = this.tabs[index];
    if (!tab) return;
    if (tab.dirty) {
      const ok = await confirmDialog({
        title: 'Cambios sin guardar',
        message: `«${tab.name}» tiene cambios sin guardar. ¿Cerrar de todos modos?`,
        confirmText: 'Cerrar sin guardar',
        danger: true,
      });
      if (!ok) return;
    }
    this.closeAt(index);
  }

  private closeAt(index: number): void {
    const tab = this.tabs[index];
    if (!tab) return;
    const view = this.loaded.get(tab.id);
    view?.pdf?.dispose();
    view?.md?.dispose();
    this.loaded.delete(tab.id);
    this.tabs = this.tabs.filter((_, i) => i !== index);
    if (this.activeIndex >= this.tabs.length) this.activeIndex = Math.max(0, this.tabs.length - 1);
    this.renderTabs();
    void this.ensureLoaded(this.activeTab());
  }

  private async closeOthers(index: number): Promise<void> {
    const dirtyOthers = this.tabs.some((t, i) => i !== index && t.dirty);
    if (dirtyOthers) {
      const ok = await confirmDialog({
        title: 'Cerrar otras pestañas',
        message: 'Hay documentos con cambios sin guardar. ¿Cerrar todas las demás pestañas?',
        confirmText: 'Cerrar sin guardar',
        danger: true,
      });
      if (!ok) return;
    }
    const keep = this.tabs[index];
    for (let i = this.tabs.length - 1; i >= 0; i--) {
      if (i !== index) this.closeAt(i);
    }
    this.activeIndex = this.tabs.indexOf(keep);
    this.renderTabs();
  }

  private async closeRight(index: number): Promise<void> {
    for (let i = this.tabs.length - 1; i > index; i--) await this.requestClose(i);
  }

  /* -------------------------------------------------------------- */
  /* Apertura de archivos                                            */
  /* -------------------------------------------------------------- */

  async openDocuments(): Promise<void> {
    const picked = await this.b.openFiles(DOC_FILTERS);
    for (const p of picked) await this.openPicked(p);
  }

  async openRecent(r: { id: string; name: string; kind: DocKind }): Promise<void> {
    await this.openPicked({ id: r.id, name: r.name, kind: r.kind });
  }

  async openPicked(picked: PickedFile): Promise<void> {
    const kind = picked.kind ?? kindFromName(picked.name) ?? 'md';
    const existing = findIndexByFile(this.tabs, picked.id);
    if (existing >= 0) {
      this.activateTab(existing);
      return;
    }
    const tab = createTab({ fileId: picked.id, name: picked.name, kind });
    this.tabs.push(tab);
    this.activeIndex = this.tabs.length - 1;
    this.persisted.recents = pushRecent(this.persisted.recents, {
      id: picked.id,
      name: picked.name,
      kind,
    });
    if (this.b.isRestorable(picked.id)) {
      this.persisted.lastFolder = dirName(picked.id) || this.persisted.lastFolder;
    }
    this.renderTabs();
    await this.ensureLoaded(tab);
    this.stateChanged();
  }

  private async reopenTab(tab: Tab): Promise<void> {
    const picked = await this.b.openFiles(
      tab.kind === 'pdf'
        ? [{ name: 'PDF', extensions: ['pdf'] }]
        : MD_FILTERS,
    );
    const p = picked[0];
    if (!p) return;
    tab.fileId = p.id;
    tab.name = p.name;
    tab.status = 'loading';
    this.loaded.delete(tab.id);
    this.renderTabs();
    await this.ensureLoaded(tab);
  }

  async openFolder(): Promise<void> {
    const res = await this.b.openFolder();
    if (!res) return;
    this.folder = res;
    this.persisted.lastFolder = res.root || this.persisted.lastFolder;
    this.sidebarSections.delete('explorer');
    this.sidebarSections.set('explorer', (host) => this.renderExplorer(host));
    this.sidebarViewId = 'explorer';
    this.setSidebarOpen(true);
    this.renderSidebar();
    this.stateChanged();
  }

  private renderExplorer(host: HTMLElement): void {
    clear(host);
    if (!this.folder) {
      host.append(el('p', { class: 'sidebar-empty', text: 'Abre una carpeta para explorar sus documentos.' }));
      return;
    }
    const header = el(
      'div',
      { class: 'explorer-root' },
      icon('folder'),
      el('span', { text: this.folder.root || 'Carpeta' }),
    );
    host.append(header);
    const list = el('div', { class: 'explorer-list' });
    for (const entry of this.folder.entries) {
      const row = el(
        'button',
        { class: 'explorer-item', title: entry.id },
        icon(entry.kind === 'pdf' ? 'pdf' : 'md'),
        el('span', { class: 'explorer-name', text: entry.name }),
      );
      row.addEventListener('click', () =>
        void this.openPicked({ id: entry.id, name: entry.name, kind: entry.kind ?? 'md' }),
      );
      list.append(row);
    }
    if (!this.folder.entries.length) {
      list.append(el('p', { class: 'sidebar-empty', text: 'No hay documentos PDF o Markdown en esta carpeta.' }));
    }
    host.append(list);
  }

  /* -------------------------------------------------------------- */
  /* Panel lateral                                                   */
  /* -------------------------------------------------------------- */

  toggleSidebar(): void {
    this.setSidebarOpen(this.sidebarEl.classList.contains('closed'));
  }

  private setSidebarOpen(open: boolean): void {
    this.sidebarEl.classList.toggle('closed', !open);
    document.getElementById('btn-sidebar')!.setAttribute('aria-pressed', String(open));
    this.persisted.sidebarOpen = open;
    this.stateChanged();
  }

  sidebarShow(viewId: string, render: (host: HTMLElement) => void): void {
    this.sidebarSections.set(viewId, render);
    if (this.sidebarViewId === 'auto' || !this.sidebarSections.has(this.sidebarViewId)) {
      this.sidebarViewId = viewId;
    }
    this.renderSidebar();
  }

  sidebarShowAll(views: Record<string, (host: HTMLElement) => void>): void {
    for (const [viewId, render] of Object.entries(views)) this.sidebarSections.set(viewId, render);
    if (this.sidebarViewId === 'auto' || !this.sidebarSections.has(this.sidebarViewId)) {
      this.sidebarViewId = Object.keys(views)[0] ?? this.sidebarViewId;
    }
    // Un único redibujado para todas las secciones (antes se rehacía el DOM
    // una vez por sección y los renders se pisaban entre sí).
    this.renderSidebar();
  }

  private renderSidebar(): void {
    const tab = this.activeTab();
    const sections = new Map(this.sidebarSections);
    if (this.folder) sections.set('explorer', (host) => this.renderExplorer(host));
    const order =
      tab?.kind === 'pdf'
        ? ['thumbs', 'outline', 'bookmarks', 'notes']
        : tab?.kind === 'md'
          ? ['explorer', 'md-outline', 'md-notes']
          : ['explorer'];
    const labels: Record<string, string> = {
      thumbs: 'Miniaturas',
      outline: 'Índice',
      bookmarks: 'Marcadores',
      explorer: 'Explorador',
      'md-outline': 'Esquema',
      notes: 'Notas',
      'md-notes': 'Notas',
    };
    const available = order.filter((id) => sections.has(id));
    if (!available.includes(this.sidebarViewId)) this.sidebarViewId = available[0] ?? 'explorer';
    clear(this.sidebarTabsEl);
    for (const id of available) {
      const btn = el('button', {
        class: `seg-btn${id === this.sidebarViewId ? ' active' : ''}`,
        'aria-pressed': id === this.sidebarViewId ? 'true' : 'false',
        text: labels[id] ?? id,
        onclick: () => {
          this.sidebarViewId = id;
          this.renderSidebar();
        },
      });
      this.sidebarTabsEl.append(btn);
    }
    clear(this.sidebarBodyEl);
    const render = sections.get(this.sidebarViewId);
    if (render) render(this.sidebarBodyEl);
    else
      this.sidebarBodyEl.append(
        el('p', { class: 'sidebar-empty', text: 'Sin secciones para este documento.' }),
      );
  }

  /* -------------------------------------------------------------- */
  /* Estado, tema y barra de estado                                  */
  /* -------------------------------------------------------------- */

  setStatus(parts: { left?: string; right?: string }): void {
    if (parts.left !== undefined) this.statusLeft.textContent = parts.left;
    if (parts.right !== undefined) this.statusRight.textContent = parts.right;
  }

  currentTheme(): 'light' | 'dark' {
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  }

  private themeIcon(): 'sun' | 'moon' {
    return this.currentTheme() === 'dark' ? 'sun' : 'moon';
  }

  toggleTheme(): void {
    const next: ThemePref = this.currentTheme() === 'dark' ? 'light' : 'dark';
    this.setThemePref(next);
  }

  setThemePref(pref: ThemePref): void {
    this.persisted.theme = pref;
    applyTheme(pref);
    const btn = document.getElementById('btn-theme')!;
    clear(btn);
    btn.append(icon(this.themeIcon()));
    this.refreshActiveTheme();
    this.stateChanged();
  }

  private refreshActiveTheme(): void {
    const tab = this.activeTab();
    const v = tab ? this.loaded.get(tab.id) : undefined;
    v?.md?.setTheme(this.currentTheme());
    const btn = document.getElementById('btn-theme')!;
    clear(btn);
    btn.append(icon(this.themeIcon()));
  }

  favoritesOf(fileId: string): FavoriteEntry[] {
    return this.persisted.favorites.filter((f) => f.id === fileId);
  }

  /* ---------- Notas ---------- */

  notesOf(docId: string): NoteEntry[] {
    return notesFor(this.notes, docId);
  }

  addNote(input: NoteInput): NoteEntry {
    this.notes = addNoteLogic(this.notes, input);
    this.scheduleNotesSave();
    return this.notes[this.notes.length - 1];
  }

  updateNote(id: string, patch: Pick<NoteEntry, 'text'> & Partial<Pick<NoteEntry, 'page'>>): void {
    this.notes = updateNoteLogic(this.notes, id, patch);
    this.scheduleNotesSave();
  }

  removeNote(id: string): void {
    this.notes = removeNoteLogic(this.notes, id);
    this.scheduleNotesSave();
  }

  rekeyNotes(fromId: string, toId: string, toName: string): void {
    this.notes = rekeyNotesLogic(this.notes, fromId, toId, toName);
    this.scheduleNotesSave();
  }

  private scheduleNotesSave(): void {
    if (this.notesTimer) clearTimeout(this.notesTimer);
    this.notesTimer = setTimeout(() => void this.flushNotes(), 400);
    this.renderSidebar();
  }

  private async flushNotes(): Promise<void> {
    if (this.notesTimer) {
      clearTimeout(this.notesTimer);
      this.notesTimer = null;
    }
    try {
      await this.b.saveNotes(serializeNotes(this.notes));
    } catch {
      /* la persistencia de notas es best-effort */
    }
  }

  toggleFavorite(entry: Omit<FavoriteEntry, 'at'>): void {
    this.persisted.favorites = toggleFavoriteLogic(this.persisted.favorites, entry);
    this.stateChanged();
  }

  private toggleFavoriteFor(tab: Tab): void {
    this.toggleFavorite({
      id: tab.fileId,
      name: tab.name,
      kind: tab.kind,
      page: tab.kind === 'pdf' ? tab.page : undefined,
    });
    this.renderSidebar();
  }

  confirm(title: string, message: string, danger = false): Promise<boolean> {
    return confirmDialog({ title, message, danger });
  }

  async printRequested(): Promise<void> {
    await this.print();
  }

  /* -------------------------------------------------------------- */
  /* Comandos                                                        */
  /* -------------------------------------------------------------- */

  commands(): Command[] {
    const tab = this.activeTab();
    const isPdf = tab?.kind === 'pdf';
    const isMd = tab?.kind === 'md';
    const pdfView = () => (tab ? this.loaded.get(tab.id)?.pdf : undefined);
    const mdView = () => (tab ? this.loaded.get(tab.id)?.md : undefined);

    const list: Command[] = [
      {
        id: 'file.open',
        title: 'Abrir documento…',
        section: 'Archivo',
        hint: 'Ctrl+O',
        run: () => this.openDocuments(),
      },
      {
        id: 'file.openFolder',
        title: 'Abrir carpeta…',
        section: 'Archivo',
        run: () => this.openFolder(),
      },
      {
        id: 'file.save',
        title: 'Guardar Markdown',
        section: 'Archivo',
        hint: 'Ctrl+S',
        enabled: () => isMd,
        run: () => this.saveMd(),
      },
      {
        id: 'file.saveAs',
        title: 'Guardar como…',
        section: 'Archivo',
        hint: 'Ctrl+Mayús+S',
        enabled: () => isMd,
        run: () => this.saveMdAs(),
      },
      {
        id: 'file.exportHtml',
        title: 'Exportar Markdown a HTML',
        section: 'Archivo',
        enabled: () => isMd,
        run: () => void mdView()?.exportHtml(),
      },
      {
        id: 'file.exportPdf',
        title: 'Exportar Markdown a PDF (impresión)',
        section: 'Archivo',
        enabled: () => isMd,
        run: () => void mdView()?.exportPdf(),
      },
      {
        id: 'doc.print',
        title: 'Imprimir',
        section: 'Documento',
        hint: 'Ctrl+P',
        enabled: () => Boolean(tab),
        run: () => void this.print(),
      },
      {
        id: 'doc.printSystem',
        title: 'Abrir con la aplicación del sistema',
        section: 'Documento',
        enabled: () => Boolean(tab) && this.b.isRestorable(tab!.fileId),
        run: () => void (tab && this.b.openWithSystem(tab.fileId)),
      },
      {
        id: 'doc.find',
        title: 'Buscar en el documento',
        section: 'Documento',
        hint: 'Ctrl+F',
        enabled: () => Boolean(tab),
        run: () => {
          if (isPdf) pdfView()?.openFind();
          else mdView()?.openFind();
        },
      },
      {
        id: 'doc.nextPage',
        title: 'Página siguiente',
        section: 'Documento',
        enabled: () => isPdf,
        run: () => pdfView()?.nextPage(),
      },
      {
        id: 'doc.prevPage',
        title: 'Página anterior',
        section: 'Documento',
        enabled: () => isPdf,
        run: () => pdfView()?.prevPage(),
      },
      {
        id: 'doc.zoomIn',
        title: 'Acercar',
        section: 'Documento',
        hint: 'Ctrl++',
        enabled: () => isPdf,
        run: () => pdfView()?.zoomIn(),
      },
      {
        id: 'doc.zoomOut',
        title: 'Alejar',
        section: 'Documento',
        hint: 'Ctrl+-',
        enabled: () => isPdf,
        run: () => pdfView()?.zoomOut(),
      },
      {
        id: 'doc.zoomReset',
        title: 'Zoom 100 %',
        section: 'Documento',
        hint: 'Ctrl+0',
        enabled: () => isPdf,
        run: () => pdfView()?.setZoom(1),
      },
      {
        id: 'doc.fitWidth',
        title: 'Ajustar al ancho',
        section: 'Documento',
        enabled: () => isPdf,
        run: () => pdfView()?.setZoom('page-width'),
      },
      {
        id: 'doc.fitPage',
        title: 'Ajustar a la página',
        section: 'Documento',
        enabled: () => isPdf,
        run: () => pdfView()?.setZoom('page-fit'),
      },
      {
        id: 'doc.rotate',
        title: 'Rotar 90°',
        section: 'Documento',
        enabled: () => isPdf,
        run: () => pdfView()?.rotate(),
      },
      {
        id: 'doc.addNote',
        title: 'Añadir nota',
        section: 'Documento',
        enabled: () => Boolean(tab),
        run: () => {
          if (isPdf) pdfView()?.addNote();
          else mdView()?.addNote();
        },
      },
      {
        id: 'doc.favorite',
        title: isPdf ? 'Marcar página como favorita' : 'Marcar documento como favorito',
        section: 'Documento',
        enabled: () => Boolean(tab),
        run: () => {
          if (tab) this.toggleFavoriteFor(tab);
        },
      },
      {
        id: 'view.sidebar',
        title: 'Mostrar/ocultar panel lateral',
        section: 'Ver',
        hint: 'Ctrl+B',
        run: () => this.toggleSidebar(),
      },
      {
        id: 'view.theme',
        title: 'Cambiar tema (claro/oscuro)',
        section: 'Ver',
        hint: 'Ctrl+T',
        run: () => this.toggleTheme(),
      },
      {
        id: 'view.themeLight',
        title: 'Tema claro',
        section: 'Ver',
        run: () => this.setThemePref('light'),
      },
      {
        id: 'view.themeDark',
        title: 'Tema oscuro',
        section: 'Ver',
        run: () => this.setThemePref('dark'),
      },
      {
        id: 'md.modeSplit',
        title: 'Markdown: vista dividida',
        section: 'Markdown',
        enabled: () => isMd,
        run: () => mdView()?.setMode('split'),
      },
      {
        id: 'md.modeEdit',
        title: 'Markdown: solo edición',
        section: 'Markdown',
        enabled: () => isMd,
        run: () => mdView()?.setMode('edit'),
      },
      {
        id: 'md.modePreview',
        title: 'Markdown: solo lectura',
        section: 'Markdown',
        enabled: () => isMd,
        run: () => mdView()?.setMode('preview'),
      },
      {
        id: 'md.readOnly',
        title: 'Markdown: alternar solo lectura del editor',
        section: 'Markdown',
        enabled: () => isMd,
        run: () => mdView()?.toggleReadOnly(),
      },
      {
        id: 'tab.close',
        title: 'Cerrar pestaña',
        section: 'Pestañas',
        hint: 'Ctrl+W',
        enabled: () => Boolean(tab),
        run: () => void this.requestClose(this.activeIndex),
      },
      {
        id: 'tab.next',
        title: 'Pestaña siguiente',
        section: 'Pestañas',
        hint: 'Ctrl+Tab',
        enabled: () => this.tabs.length > 1,
        run: () => this.activateTab(nextIndex(this.activeIndex, this.tabs.length, 1)),
      },
      {
        id: 'tab.prev',
        title: 'Pestaña anterior',
        section: 'Pestañas',
        hint: 'Ctrl+Mayús+Tab',
        enabled: () => this.tabs.length > 1,
        run: () => this.activateTab(nextIndex(this.activeIndex, this.tabs.length, -1)),
      },
      {
        id: 'palette.open',
        title: 'Paleta de comandos',
        section: 'Ayuda',
        hint: 'Ctrl+K',
        run: () => this.palette.toggle(),
      },
      {
        id: 'help.shortcuts',
        title: 'Ver atajos de teclado',
        section: 'Ayuda',
        run: () => {
          const lines = Object.entries(GLOBAL_SHORTCUTS)
            .map(([combo, id]) => `${combo} → ${id}`)
            .join('\n');
          void infoDialog({
            title: 'Atajos de teclado',
            message: lines,
          });
        },
      },
    ];
    return list;
  }

  private commandById(id: string): Command | undefined {
    return this.commands().find((c) => c.id === id);
  }

  private wireShortcuts(): void {
    window.addEventListener('keydown', (e) => {
      const combo = resolveShortcut(e, { 'Ctrl+=': 'doc.zoomIn' });
      if (!combo) return;
      const cmd = this.commandById(combo);
      if (!cmd) return;
      if (cmd.enabled && !cmd.enabled()) return;
      const target = e.target as HTMLElement | null;
      const typing = Boolean(
        target?.closest?.('input, textarea, .cm-editor, [contenteditable="true"]'),
      );
      if (typing && !TYPING_ALLOWED.has(combo)) return;
      e.preventDefault();
      void cmd.run();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const pdf = this.loaded.get(this.activeTab()?.id ?? '')?.pdf;
        if (pdf?.isFindOpen()) pdf.closeFind();
      }
    });
  }

  private wireDragAndDrop(): void {
    const overlay = document.getElementById('drop-overlay')!;
    window.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault();
        overlay.hidden = false;
      }
    });
    window.addEventListener('dragleave', (e) => {
      if (e.relatedTarget === null) overlay.hidden = true;
    });
    window.addEventListener('drop', (e) => {
      overlay.hidden = true;
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (!files.length) return;
      e.preventDefault();
      void (async () => {
        for (const f of files) {
          const kind = kindFromName(f.name);
          if (!kind) continue;
          const { registerExternalFile } = await import('./core/bridge');
          const picked = registerExternalFile(f);
          await this.openPicked(picked);
        }
      })();
    });
  }

  /* -------------------------------------------------------------- */
  /* Guardado e impresión                                            */
  /* -------------------------------------------------------------- */

  private async saveMd(): Promise<void> {
    const tab = this.activeTab();
    const view = tab ? this.loaded.get(tab.id)?.md : undefined;
    if (!tab || !view) return;
    const text = view.getText();
    const res = await this.b.writeText(tab.fileId, text, { overwrite: true });
    if (res === 'ok') {
      view.markClean();
      this.renderTabs();
      this.setStatus({ right: 'Guardado' });
    } else if (res === 'exists') {
      const ok = await this.confirm('El archivo ya existe', `«${tab.name}» ya existe. ¿Sobrescribirlo?`, true);
      if (ok) await this.saveMd();
    }
    this.stateChanged();
  }

  private async saveMdAs(): Promise<void> {
    const tab = this.activeTab();
    const view = tab ? this.loaded.get(tab.id)?.md : undefined;
    if (!tab || !view) return;
    const target = await this.b.resolveSaveTarget(tab.name, MD_FILTERS);
    if (!target) return;
    if (await this.b.exists(target.id)) {
      const ok = await this.confirm('El archivo ya existe', `«${target.name}» ya existe. ¿Sobrescribirlo?`, true);
      if (!ok) return;
    }
    const res = await this.b.writeText(target.id, view.getText(), { overwrite: true });
    if (res === 'ok' || res === 'downloaded') {
      tab.fileId = target.id;
      tab.name = target.name;
      view.setFileRef(target.id, target.name);
      view.markClean();
      this.renderTabs();
      this.setStatus({ right: `Guardado como ${target.name}` });
    }
    this.stateChanged();
  }

  private async print(): Promise<void> {
    const tab = this.activeTab();
    if (!tab) return;
    if (tab.kind === 'pdf') {
      if (this.b.isRestorable(tab.fileId)) {
        const useSystem = await confirmDialog({
          title: 'Imprimir PDF',
          message:
            'Para una impresión fiel, Vela abre el documento con la aplicación del sistema. ' +
            '¿Continuar? (Cancelar imprime desde Vela con la calidad del visor integrado)',
          confirmText: 'Abrir visor del sistema',
          cancelText: 'Imprimir desde Vela',
        });
        if (useSystem) {
          await printPdfWithSystem(tab.fileId);
          return;
        }
      }
      const bytes = await this.b.readBytes(tab.fileId);
      printPdfInApp(bytes, tab.name);
    } else {
      await this.loaded.get(tab.id)?.md?.exportPdf();
    }
  }

  /* -------------------------------------------------------------- */
  /* Persistencia                                                    */
  /* -------------------------------------------------------------- */

  private snapshot(): PersistedState {
    return {
      ...this.persisted,
      session: tabsToSession(this.tabs),
      activeIndex: this.activeIndex,
    };
  }

  stateChanged(): void {
    this.persisted.session = tabsToSession(this.tabs);
    this.persisted.activeIndex = this.activeIndex;
    this.persistence.schedule();
  }

  tabsChanged(): void {
    this.renderTabs();
  }
}
