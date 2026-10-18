/** Pruebas del zoom con pellizco/Ctrl+rueda: nunca escala la interfaz. */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  gestureZoomFactor,
  wheelZoomFactor,
  wireZoomGestures,
  wireZoomHotkeyGuard,
} from '../src/ui/zoomGestures';

function fireWheel(target: EventTarget, init: WheelEventInit): WheelEvent {
  const ev = new WheelEvent('wheel', { cancelable: true, bubbles: true, ...init });
  target.dispatchEvent(ev);
  return ev;
}

function fireGesture(type: string, target: EventTarget, scale?: number): Event {
  const ev = new Event(type, { cancelable: true, bubbles: true });
  if (scale !== undefined) Object.defineProperty(ev, 'scale', { value: scale });
  target.dispatchEvent(ev);
  return ev;
}

describe('factores de zoom', () => {
  it('la rueda hacia arriba acerca y hacia abajo aleja', () => {
    expect(wheelZoomFactor(-100)).toBeGreaterThan(1);
    expect(wheelZoomFactor(100)).toBeLessThan(1);
    expect(wheelZoomFactor(0)).toBe(1);
    expect(wheelZoomFactor(Number.NaN)).toBe(1);
  });

  it('la rueda nunca salta más del doble por evento', () => {
    expect(wheelZoomFactor(-100_000)).toBe(2);
    expect(wheelZoomFactor(100_000)).toBe(0.5);
  });

  it('el pellizco sigue la escala acumulada de WebKit, con límites', () => {
    expect(gestureZoomFactor(1, 1.2)).toBeCloseTo(1.2, 5);
    expect(gestureZoomFactor(1.2, 1)).toBeCloseTo(1 / 1.2, 5);
    expect(gestureZoomFactor(1, 100)).toBe(2);
    expect(gestureZoomFactor(100, 1)).toBe(0.5);
    expect(gestureZoomFactor(0, 1)).toBe(1);
  });
});

describe('wireZoomGestures', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()?.();
    document.body.innerHTML = '';
  });

  function setup(): {
    onZoom: ReturnType<typeof vi.fn>;
    isDocumentTarget: (t: EventTarget | null) => boolean;
  } {
    const onZoom = vi.fn();
    const doc = document.createElement('div');
    doc.id = 'doc';
    document.body.append(doc);
    const other = document.createElement('div');
    other.id = 'other';
    document.body.append(other);
    const isDocumentTarget = (t: EventTarget | null) =>
      t instanceof HTMLElement && t.id === 'doc';
    cleanups.push(wireZoomGestures(window, { onZoom, isDocumentTarget }));
    return { onZoom, isDocumentTarget };
  }

  it('Ctrl+rueda sobre el documento: se previene y cambia el zoom del PDF', () => {
    const { onZoom } = setup();
    const ev = fireWheel(document.getElementById('doc')!, { ctrlKey: true, deltaY: -100 });
    // Prevenido ⇒ el navegador/WebView no puede escalar la interfaz.
    expect(ev.defaultPrevented).toBe(true);
    expect(onZoom).toHaveBeenCalledTimes(1);
    expect(onZoom.mock.calls[0][0]).toBeGreaterThan(1);
  });

  it('Ctrl+rueda sobre el resto de la interfaz: se previene, pero sin zoom de documento', () => {
    const { onZoom } = setup();
    const ev = fireWheel(document.getElementById('other')!, { ctrlKey: true, deltaY: -100 });
    expect(ev.defaultPrevented).toBe(true);
    expect(onZoom).not.toHaveBeenCalled();
  });

  it('la rueda sin Ctrl sigue haciendo scroll (no se previene)', () => {
    const { onZoom } = setup();
    const ev = fireWheel(document.getElementById('doc')!, { ctrlKey: false, deltaY: 120 });
    expect(ev.defaultPrevented).toBe(false);
    expect(onZoom).not.toHaveBeenCalled();
  });

  it('los gestos de WebKit se consumen siempre y solo zooman sobre el PDF', () => {
    const { onZoom } = setup();
    const doc = document.getElementById('doc')!;
    const start = fireGesture('gesturestart', doc, 1);
    expect(start.defaultPrevented).toBe(true);
    const change = fireGesture('gesturechange', doc, 1.25);
    expect(change.defaultPrevented).toBe(true);
    expect(onZoom).toHaveBeenCalledTimes(1);
    expect(onZoom.mock.calls[0][0]).toBeCloseTo(1.25, 5);
    const end = fireGesture('gestureend', doc, 1.25);
    expect(end.defaultPrevented).toBe(true);
  });

  it('el pellizco sobre Markdown/interfaz nunca escala la aplicación', () => {
    const { onZoom } = setup();
    const other = document.getElementById('other')!;
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
      expect(fireGesture(type, other, 1.4).defaultPrevented).toBe(true);
    }
    expect(onZoom).not.toHaveBeenCalled();
  });

  it('no aplica el zoom dos veces si WebKit manda gesto y rueda del mismo pellizco', () => {
    const { onZoom } = setup();
    const doc = document.getElementById('doc')!;
    fireGesture('gesturestart', doc, 1);
    fireGesture('gesturechange', doc, 1.1);
    expect(onZoom).toHaveBeenCalledTimes(1);
    const ev = fireWheel(doc, { ctrlKey: true, deltaY: -100 });
    expect(ev.defaultPrevented).toBe(true);
    expect(onZoom).toHaveBeenCalledTimes(1);
  });

  it('Ctrl++, Ctrl+- y Ctrl+0 nunca activan el zoom nativo del webview', () => {
    const clean = wireZoomHotkeyGuard(window);
    const input = document.createElement('input');
    document.body.append(input);
    // También mientras se escribe (el zoom nativo no debe salir ni ahí).
    for (const key of ['+', '-', '=', '0', '_', ')']) {
      const ev = new KeyboardEvent('keydown', {
        key,
        ctrlKey: true,
        cancelable: true,
        bubbles: true,
      });
      input.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(true);
    }
    // Sin Ctrl no se toca nada.
    const plain = new KeyboardEvent('keydown', {
      key: '-',
      ctrlKey: false,
      cancelable: true,
      bubbles: true,
    });
    input.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(false);
    clean();
    input.remove();
  });
});
