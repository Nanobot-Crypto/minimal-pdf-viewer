/** Pruebas del zoom con pellizco/Ctrl+rueda: nunca escala la interfaz. */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  gestureZoomFactor,
  smoothPinchDistance,
  touchDistance,
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

/* ------------------------------------------------------------------ */
/* Pulsaciones de dos dedos (capa táctil)                              */
/* ------------------------------------------------------------------ */

interface FakeTouch {
  clientX: number;
  clientY: number;
}

function fireTouch(
  type: string,
  target: EventTarget,
  touches: FakeTouch[],
): Event {
  const ev = new Event(type, { cancelable: true, bubbles: true });
  Object.defineProperty(ev, 'touches', { value: touches });
  target.dispatchEvent(ev);
  return ev;
}

describe('pellizco táctil (dos dedos)', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()?.();
    document.body.innerHTML = '';
  });

  function setup(): { onZoom: ReturnType<typeof vi.fn> } {
    const onZoom = vi.fn();
    const doc = document.createElement('div');
    doc.id = 'doc';
    document.body.append(doc);
    cleanups.push(
      wireZoomGestures(window, {
        onZoom,
        isDocumentTarget: (t) => t instanceof HTMLElement && t.id === 'doc',
      }),
    );
    return { onZoom };
  }

  it('el pellizco sobre el PDF se consume y hace zoom con suavizado', () => {
    const { onZoom } = setup();
    const doc = document.getElementById('doc')!;
    const start = fireTouch('touchstart', doc, [
      { clientX: 100, clientY: 100 },
      { clientX: 200, clientY: 100 },
    ]);
    expect(start.defaultPrevented).toBe(true);
    // Dedos separados: distancia 100 → 160. El suavizado no permite un salto
    // completo en el primer movimiento, pero el factor es siempre > 1.
    const move = fireTouch('touchmove', doc, [
      { clientX: 100, clientY: 100 },
      { clientX: 260, clientY: 100 },
    ]);
    expect(move.defaultPrevented).toBe(true);
    expect(onZoom).toHaveBeenCalled();
    const first = onZoom.mock.calls[0][0] as number;
    expect(first).toBeGreaterThan(1);
    expect(first).toBeLessThan(1.7); // suavizado: no aplica el salto entero
    // Tras varios movimientos, el zoom acumulado se acerca al factor real.
    for (let i = 0; i < 8; i++) {
      fireTouch('touchmove', doc, [
        { clientX: 100, clientY: 100 },
        { clientX: 260, clientY: 100 },
      ]);
    }
    const total = (onZoom.mock.calls.map((c) => c[0] as number) as number[]).reduce((a, b) => a * b, 1);
    expect(total).toBeGreaterThan(1.4);
    expect(total).toBeLessThanOrEqual(1.61); // límite del factor por evento

    const end = fireTouch('touchend', doc, []);
    expect(end.defaultPrevented).toBe(true);
  });

  it('el pellizco sobre la interfaz se consume pero no zooma el documento', () => {
    const { onZoom } = setup();
    const other = document.createElement('div');
    other.id = 'other';
    document.body.append(other);
    for (const type of ['touchstart', 'touchmove']) {
      const ev = fireTouch(type, other, [
        { clientX: 0, clientY: 0 },
        { clientX: 120, clientY: 0 },
      ]);
      expect(ev.defaultPrevented).toBe(true);
    }
    expect(fireTouch('touchend', other, []).defaultPrevented).toBe(true);
    expect(onZoom).not.toHaveBeenCalled();
  });

  it('una sola pulsación (scroll) no se consume', () => {
    const { onZoom } = setup();
    const doc = document.getElementById('doc')!;
    const ev = fireTouch('touchmove', doc, [{ clientX: 5, clientY: 5 }]);
    expect(ev.defaultPrevented).toBe(false);
    expect(onZoom).not.toHaveBeenCalled();
  });
});

describe('suavizado del pellizco', () => {
  it('la distancia suavizada queda entre la anterior y la nueva', () => {
    expect(smoothPinchDistance(100, 200)).toBeCloseTo(145, 5);
    expect(smoothPinchDistance(100, 200, 1)).toBe(200);
    expect(smoothPinchDistance(100, 200, 0)).toBe(100);
  });

  it('converge al valor real cuando el gesto se detiene', () => {
    let d = 100;
    for (let i = 0; i < 30; i++) d = smoothPinchDistance(d, 200);
    expect(d).toBeCloseTo(200, 3);
  });

  it('ignora distancias inválidas', () => {
    expect(smoothPinchDistance(100, Number.NaN)).toBe(100);
    expect(smoothPinchDistance(100, -5)).toBe(100);
    expect(smoothPinchDistance(0, 80)).toBe(80);
  });

  it('la distancia entre dedos es euclídea', () => {
    expect(touchDistance({ clientX: 0, clientY: 0 }, { clientX: 3, clientY: 4 })).toBe(5);
  });
});

describe('modo diagnóstico (onEvent)', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()?.();
    document.body.innerHTML = '';
  });

  it('registra rueda, gestos, teclas y pellizco con sus datos', () => {
    const events: string[] = [];
    const onZoom = vi.fn();
    const doc = document.createElement('div');
    doc.id = 'doc';
    document.body.append(doc);
    cleanups.push(
      wireZoomGestures(window, {
        onZoom,
        isDocumentTarget: (t) => t instanceof HTMLElement && t.id === 'doc',
        onEvent: (info) => events.push(`${info.type}:${info.consumed ? 'ok' : 'no'}`),
      }),
    );
    cleanups.push(wireZoomHotkeyGuard(window, (info) => events.push(`${info.type}:ok`)));

    fireWheel(doc, { ctrlKey: true, deltaY: -100 });
    fireGesture('gesturestart', doc, 1);
    fireTouch('touchstart', doc, [{ clientX: 0, clientY: 0 }, { clientX: 90, clientY: 0 }]);
    const key = new KeyboardEvent('keydown', { key: '+', ctrlKey: true, cancelable: true, bubbles: true });
    doc.dispatchEvent(key);

    expect(events).toContain('wheel:ok');
    expect(events).toContain('gesture:ok');
    expect(events).toContain('touch:ok');
    expect(events).toContain('hotkey:ok');
  });
});
