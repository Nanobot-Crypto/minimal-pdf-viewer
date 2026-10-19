/**
 * Modo diagnóstico de zoom: registro de los últimos eventos de zoom.
 *
 * Ajuste «Registrar eventos de zoom» (desactivado por defecto). Mientras está
 * activo se muestra un panel flotante con los últimos 20 eventos (tipo,
 * ctrlKey, deltaY, escala, zoom del webview y del PDF) para poder mandar una
 * captura si el pellizco sigue ampliando la interfaz. No sale nada por red.
 */

import { el } from './dom';
import type { ZoomEventInfo } from './zoomGestures';

export interface ZoomLogEntry extends ZoomEventInfo {
  /** Instante (ms desde epoch). */
  t: number;
  /** Zoom del webview (capa Rust); `null` en navegador. */
  webviewZoom: number | null;
  /** Zoom del PDF (escala 1.0 = 100 %). */
  pdfZoom: number | null;
}

/** Últimos eventos registrados (máximo 20, más reciente al final). */
export const ZOOM_LOG_LIMIT = 20;

const entries: ZoomLogEntry[] = [];
let panel: HTMLElement | null = null;
let enabled = false;

/** Registra un evento de zoom (siempre; solo se muestra con el ajuste activo). */
export function recordZoomEvent(
  info: ZoomEventInfo,
  extra: { webviewZoom?: number | null; pdfZoom?: number | null } = {},
): void {
  entries.push({
    ...info,
    t: Date.now(),
    webviewZoom: extra.webviewZoom ?? null,
    pdfZoom: extra.pdfZoom ?? null,
  });
  while (entries.length > ZOOM_LOG_LIMIT) entries.shift();
  if (enabled) renderPanel();
}

export function zoomLogEntries(): ZoomLogEntry[] {
  return entries.slice();
}

export function clearZoomLog(): void {
  entries.length = 0;
  if (enabled) renderPanel();
}

/** Activa/desactiva el panel de diagnóstico (controlado por Ajustes). */
export function setZoomLogEnabled(on: boolean): void {
  enabled = on;
  if (!on) {
    panel?.remove();
    panel = null;
    return;
  }
  renderPanel();
}

export function isZoomLogEnabled(): boolean {
  return enabled;
}

function fmt(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

function renderPanel(): void {
  if (!panel) {
    panel = el('div', {
      class: 'zoom-log',
      id: 'zoom-log',
      role: 'status',
      'aria-label': 'Registro de eventos de zoom',
    });
    document.body.append(panel);
  }
  panel.replaceChildren(
    el('div', { class: 'zoom-log-head' },
      el('span', { text: 'Registro de zoom (últimos 20)' }),
      el('span', { class: 'zoom-log-sub', text: 'Ajustes → Diagnóstico para apagar' }),
    ),
    el(
      'div',
      { class: 'zoom-log-body' },
      ...entries.slice(-ZOOM_LOG_LIMIT).map((e) =>
        el(
          'div',
          { class: 'zoom-log-row' },
          el('span', { class: 'zoom-log-type', text: e.type }),
          el('span', {
            text: `ctrl=${e.ctrlKey ? 'sí' : 'no'} Δy=${fmt(e.deltaY, 0)} escala=${fmt(e.scale)} →×${fmt(e.factor)} webview=${fmt(e.webviewZoom)} pdf=${fmt(e.pdfZoom)}`,
          }),
        ),
      ),
    ),
  );
}
