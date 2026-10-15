/**
 * Barra de título integrada (ventana sin decoración nativa, estilo GNOME).
 *
 * - Pestañas en la misma fila que la barra.
 * - Botones minimizar / maximizar / cerrar al estilo Adwaita.
 * - Arrastre de la ventana (`data-tauri-drag-region`) y doble clic para maximizar.
 * - Redimensionado por los bordes con `startResizeDragging` (lo gestiona el
 *   compositor: idéntico en Wayland y X11).
 *
 * En modo navegador no hay ventana propia: los controles permanecen ocultos.
 */

import { bridge } from '../core/bridge';
import { clear } from './dom';
import { icon } from './icons';

type ResizeDir =
  | 'East'
  | 'North'
  | 'NorthEast'
  | 'NorthWest'
  | 'South'
  | 'SouthEast'
  | 'SouthWest'
  | 'West';

export async function initTitlebar(): Promise<void> {
  const controls = document.getElementById('window-controls');
  const handles = Array.from(document.querySelectorAll<HTMLElement>('.resize-handle'));
  if (!bridge.isTauri || !controls) return;

  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const win = getCurrentWindow();

  const btnMin = document.getElementById('btn-win-min')!;
  const btnMax = document.getElementById('btn-win-max')!;
  const btnClose = document.getElementById('btn-win-close')!;
  btnMin.append(icon('winMin'));
  btnMax.append(icon('winMax'));
  btnClose.append(icon('winClose'));
  controls.hidden = false;
  for (const h of handles) h.hidden = false;

  btnMin.addEventListener('click', () => void win.minimize());
  btnMax.addEventListener('click', () => void win.toggleMaximize());
  btnClose.addEventListener('click', () => void win.close());

  // Doble clic en la barra (fuera de botones y pestañas): maximizar/restaurar.
  const topbar = document.getElementById('topbar')!;
  topbar.addEventListener('dblclick', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('button, .tab, input, select, textarea')) return;
    void win.toggleMaximize();
  });

  // Redimensionado por bordes y esquinas.
  for (const h of handles) {
    h.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const dir = h.dataset.resize as ResizeDir | undefined;
      if (!dir) return;
      e.preventDefault();
      void win.startResizeDragging(dir).catch(() => {
        /* sin permiso o ventana fija: se ignora */
      });
    });
  }

  // El botón maximizar muestra el icono de restaurar cuando corresponde.
  const syncMax = async (): Promise<void> => {
    const maximized = await win.isMaximized().catch(() => false);
    clear(btnMax);
    btnMax.append(icon(maximized ? 'winRestore' : 'winMax'));
    btnMax.title = maximized ? 'Restaurar' : 'Maximizar';
    btnMax.setAttribute('aria-label', btnMax.title);
  };
  await syncMax();
  await win.onResized(() => void syncMax());
}
