/** Estados de pantalla: vacío, error y archivo no disponible. */

import type { RecentEntry } from '../core/types';
import { el } from './dom';
import { icon } from './icons';

export function EmptyView(opts: {
  recents: RecentEntry[];
  onOpenFile: () => void;
  onOpenFolder: () => void;
  onOpenRecent: (r: RecentEntry) => void;
}): HTMLElement {
  const recentList = el('div', { class: 'recent-list' });
  for (const r of opts.recents.slice(0, 8)) {
    const row = el(
      'button',
      { class: 'recent-item', title: r.id },
      icon(r.kind === 'pdf' ? 'pdf' : 'md'),
      el('span', { class: 'recent-name', text: r.name }),
      el('span', { class: 'recent-kind', text: r.kind === 'pdf' ? 'PDF' : 'Markdown' }),
    );
    row.addEventListener('click', () => opts.onOpenRecent(r));
    recentList.append(row);
  }

  return el(
    'div',
    { class: 'empty-state' },
    el(
      'div',
      { class: 'empty-card' },
      el('div', { class: 'empty-logo', 'aria-hidden': 'true' }),
      el('h1', { text: 'Vela' }),
      el('p', {
        class: 'empty-sub',
        text: 'Visor local de PDF y Markdown. Arrastra un documento aquí o ábrelo desde tu equipo.',
      }),
      el(
        'div',
        { class: 'empty-actions' },
        el('button', { class: 'btn btn-primary', text: 'Abrir documento', onclick: opts.onOpenFile }),
        el('button', { class: 'btn', text: 'Abrir carpeta', onclick: opts.onOpenFolder }),
      ),
      opts.recents.length
        ? el(
            'div',
            { class: 'recent' },
            el('h2', { class: 'recent-title', text: 'Recientes' }),
            recentList,
          )
        : null,
    ),
  );
}

export function ErrorView(opts: {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}): HTMLElement {
  return el(
    'div',
    { class: 'error-state' },
    el(
      'div',
      { class: 'error-card' },
      icon('warning'),
      el('h2', { text: opts.title }),
      el('p', { class: 'error-message', text: opts.message }),
      opts.actionLabel && opts.onAction
        ? el('button', { class: 'btn btn-primary', text: opts.actionLabel, onclick: opts.onAction })
        : null,
    ),
  );
}

export function MissingView(opts: { name: string; onReopen: () => void }): HTMLElement {
  return ErrorView({
    title: 'Documento no disponible',
    message: `«${opts.name}» no se pudo volver a abrir automáticamente. Vuelve a seleccionarlo para continuar.`,
    actionLabel: 'Reabrir documento',
    onAction: opts.onReopen,
  });
}

export function LoadingView(name: string): HTMLElement {
  return el(
    'div',
    { class: 'loading-state' },
    el('div', { class: 'spinner', 'aria-hidden': 'true' }),
    el('p', { text: `Abriendo ${name}…` }),
  );
}
