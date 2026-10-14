/** Menú contextual ligero. */

import { el } from './dom';

export interface MenuItem {
  label?: string;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
  action?: () => void;
}

export function showContextMenu(x: number, y: number, items: MenuItem[]): void {
  hideContextMenu();
  const menu = el('div', { class: 'context-menu', role: 'menu' });
  for (const item of items) {
    if (item.separator) {
      menu.append(el('div', { class: 'context-sep' }));
      continue;
    }
    const row = el(
      'button',
      {
        class: `context-item${item.danger ? ' danger' : ''}`,
        role: 'menuitem',
        disabled: item.disabled || false,
      },
      el('span', { class: 'context-label', text: item.label ?? '' }),
      item.shortcut ? el('span', { class: 'context-shortcut', text: item.shortcut }) : null,
    );
    row.addEventListener('click', () => {
      hideContextMenu();
      item.action?.();
    });
    menu.append(row);
  }
  const layer = document.getElementById('menu-layer')!;
  layer.append(menu);
  requestAnimationFrame(() => {
    const rect = menu.getBoundingClientRect();
    const px = Math.min(x, window.innerWidth - rect.width - 8);
    const py = Math.min(y, window.innerHeight - rect.height - 8);
    menu.style.left = `${Math.max(4, px)}px`;
    menu.style.top = `${Math.max(4, py)}px`;
    menu.classList.add('open');
  });
  setTimeout(() => {
    window.addEventListener('mousedown', onAway, { once: true });
    window.addEventListener('keydown', onEsc, { once: true });
  }, 0);

  function onAway(e: MouseEvent): void {
    if (!(e.target as HTMLElement).closest('.context-menu')) hideContextMenu();
    else window.addEventListener('mousedown', onAway, { once: true });
  }
  function onEsc(e: KeyboardEvent): void {
    if (e.key === 'Escape') hideContextMenu();
    else window.addEventListener('keydown', onEsc, { once: true });
  }
}

export function hideContextMenu(): void {
  const layer = document.getElementById('menu-layer')!;
  while (layer.firstChild) layer.removeChild(layer.firstChild);
}
