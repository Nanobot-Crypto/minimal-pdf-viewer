/** Paleta de comandos (Ctrl+K) con búsqueda difusa. */

import { rankItems } from '../core/fuzzy';
import { el } from './dom';

export interface Command {
  id: string;
  title: string;
  section?: string;
  hint?: string;
  enabled?: () => boolean;
  run: () => void | Promise<void>;
}

export class CommandPalette {
  private open = false;
  private query = '';
  private selected = 0;
  private results: Command[] = [];

  constructor(private getCommands: () => Command[]) {}

  isOpen(): boolean {
    return this.open;
  }

  toggle(): void {
    if (this.open) this.close();
    else this.show();
  }

  show(initialQuery = ''): void {
    if (this.open) return;
    this.open = true;
    this.query = initialQuery;
    this.selected = 0;
    const overlay = document.getElementById('palette-overlay')!;
    overlay.hidden = false;
    overlay.innerHTML = '';
    const input = el('input', {
      class: 'palette-input',
      type: 'text',
      placeholder: 'Escribe un comando…',
      'aria-label': 'Paleta de comandos',
      value: initialQuery,
    });
    const list = el('div', { class: 'palette-list', role: 'listbox' });
    const box = el('div', { class: 'palette' }, input, list);
    overlay.append(box);
    overlay.addEventListener('mousedown', this.onBackdrop);
    input.addEventListener('input', () => {
      this.query = input.value;
      this.selected = 0;
      this.renderList(list);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.selected = Math.min(this.selected + 1, this.results.length - 1);
        this.updateSelection(list);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.selected = Math.max(this.selected - 1, 0);
        this.updateSelection(list);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        this.runAt(this.selected);
      }
    });
    // Clic delegado: funciona aunque las filas se reconstruyan.
    list.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest('.palette-item') as HTMLElement | null;
      if (!row) return;
      const index = Number(row.dataset.index);
      if (Number.isFinite(index)) this.runAt(index);
    });
    this.renderList(list);
    input.focus();
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    const overlay = document.getElementById('palette-overlay')!;
    overlay.hidden = true;
    overlay.innerHTML = '';
    overlay.removeEventListener('mousedown', this.onBackdrop);
  }

  private runAt(index: number): void {
    const cmd = this.results[index];
    if (!cmd) return;
    this.close();
    void cmd.run();
  }

  private onBackdrop = (e: MouseEvent): void => {
    if ((e.target as HTMLElement).id === 'palette-overlay') this.close();
  };

  /** Reconstruye la lista (solo al cambiar la consulta; nunca al pasar el ratón). */
  private renderList(list: HTMLElement): void {
    const all = this.getCommands().filter((c) => (c.enabled ? c.enabled() : true));
    this.results = rankItems(this.query, all, (c) => `${c.section ?? ''} ${c.title}`.trim());
    list.innerHTML = '';
    if (!this.results.length) {
      list.append(el('div', { class: 'palette-empty', text: 'Sin resultados' }));
      return;
    }
    this.results.forEach((cmd, i) => {
      const row = el(
        'div',
        {
          class: `palette-item${i === this.selected ? ' selected' : ''}`,
          role: 'option',
          'aria-selected': i === this.selected ? 'true' : 'false',
        },
        el('span', { class: 'palette-title', text: cmd.title }),
        cmd.section ? el('span', { class: 'palette-section', text: cmd.section }) : null,
        cmd.hint ? el('span', { class: 'palette-hint', text: cmd.hint }) : null,
      );
      row.dataset.index = String(i);
      // Solo resaltado: reemplazar el DOM aquí rompía los clics (mousedown y
      // mouseup caían en nodos distintos y el evento click nunca se disparaba).
      row.addEventListener('mouseenter', () => {
        this.selected = i;
        this.updateSelection(list);
      });
      list.append(row);
    });
    this.updateSelection(list);
  }

  /** Actualiza el resaltado sin tocar la estructura del DOM. */
  private updateSelection(list: HTMLElement): void {
    const rows = list.querySelectorAll('.palette-item');
    rows.forEach((row, i) => {
      const active = i === this.selected;
      row.classList.toggle('selected', active);
      row.setAttribute('aria-selected', active ? 'true' : 'false');
      if (active) (row as HTMLElement).scrollIntoView({ block: 'nearest' });
    });
  }
}
