/**
 * Zoom con el pellizco del trackpad y con la rueda + Ctrl.
 *
 * En WebKitGTK (Tauri sobre Linux) el pellizco amplía TODO el webview si la
 * página no consume el gesto (desaparecen la barra superior y la lateral); en
 * Chromium el pellizco llega como eventos `wheel` con `ctrlKey`. Aquí ambos se
 * consumen SIEMPRE con `preventDefault` (listeners no pasivos): la interfaz
 * nunca debe escalarse. Solo cuando el gesto cae sobre el documento PDF se
 * convierte en zoom del documento, reutilizando su lógica de zoom con límites.
 *
 * Capas de defensa (ver docs/ARCHITECTURE.md):
 *  1. CSS/HTML: `touch-action` sin `pinch-zoom` y viewport con
 *     `user-scalable=no` (index.html + styles/base.css).
 *  2. Esta capa JS: `wheel`+Ctrl, `gesturestart/change/end` de WebKit y
 *     pulsaciones de dos dedos, todos no pasivos con `preventDefault`.
 *  3. Rust (src-tauri/src/main.rs): el zoom nativo del webview se repone a
 *     1.0 y, si se escapa un gesto, se emite un evento de Tauri con el factor
 *     para que el frontend lo aplique al PDF.
 */

/** Límites del factor por evento (evita saltos bruscos con deltas extremos). */
const MIN_FACTOR = 0.5;
const MAX_FACTOR = 2;
/**
 * Ventana en la que un `wheel` con Ctrl se atribuye a un pellizco ya gestionado
 * (WebKitGTK puede generar ambos tipos de eventos para el mismo gesto y el zoom
 * saldría doble).
 */
const GESTURE_WHEEL_WINDOW_MS = 400;
/**
 * Suavizado exponencial de la distancia del pellizco táctil: los `touchmove`
 * llegan a decenas por segundo y sin suavizar el zoom tiembla. Se suaviza la
 * distancia (no el factor) para no desviar el punto final del gesto.
 */
export const PINCH_SMOOTH_ALPHA = 0.45;

function clampFactor(factor: number): number {
  return Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, factor));
}

/** Factor de zoom para un desplazamiento de rueda (negativo = acercar). */
export function wheelZoomFactor(deltaY: number): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 1;
  return clampFactor(Math.pow(1.001, -deltaY));
}

/** Factor de zoom para un pellizco (escalas acumuladas de WebKit, desde → hasta). */
export function gestureZoomFactor(from: number, to: number): number {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0 || to <= 0) return 1;
  return clampFactor(to / from);
}

/**
 * Suavizado exponencial de la distancia entre los dedos. Devuelve un valor
 * entre `prev` y `raw` (converge a `raw` cuando el gesto se detiene).
 */
export function smoothPinchDistance(prev: number, raw: number, alpha = PINCH_SMOOTH_ALPHA): number {
  if (!Number.isFinite(raw) || raw <= 0) return prev;
  if (!Number.isFinite(prev) || prev <= 0) return raw;
  return prev + (raw - prev) * alpha;
}

/** Distancia euclídea entre dos pulsaciones. */
export function touchDistance(
  a: { clientX: number; clientY: number },
  b: { clientX: number; clientY: number },
): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

/** Evento de zoom registrado (para el modo diagnóstico). */
export interface ZoomEventInfo {
  /** 'wheel' | 'gesture' | 'touch' | 'hotkey' | 'webview' (capa Rust). */
  type: string;
  ctrlKey?: boolean;
  deltaY?: number;
  /** Escala acumulada del gesto (WebKit/táctil), si procede. */
  scale?: number;
  /** Factor final aplicado al zoom del documento. */
  factor?: number;
  /** `true` si el evento se consumió (preventDefault). */
  consumed?: boolean;
}

export interface ZoomGestureHandlers {
  /** Aplica el factor de zoom del documento (solo llega cuando procede). */
  onZoom(factor: number): void;
  /** ¿El gesto cae sobre el documento PDF y no sobre el resto de la interfaz? */
  isDocumentTarget(target: EventTarget | null): boolean;
  /** Registro opcional de TODOS los eventos de zoom (modo diagnóstico). */
  onEvent?(info: ZoomEventInfo): void;
}

/** Eventos de gesto de WebKit (Safari / WebKitGTK): escala acumulada del pellizco. */
interface WebkitGestureEvent extends Event {
  scale?: number;
}

/**
 * Registra los listeners globales de zoom (no pasivos, en fase de captura).
 * Devuelve la función que los elimina.
 */
export function wireZoomGestures(win: Window, handlers: ZoomGestureHandlers): () => void {
  let gestureScale = 1;
  let lastGestureAt = 0;
  /** Estado del pellizco táctil (dos dedos). */
  let touchDist = 0;
  let touchSmoothDist = 0;

  const log = (info: ZoomEventInfo): void => {
    handlers.onEvent?.(info);
  };

  const onWheel = (e: WheelEvent) => {
    if (!e.ctrlKey) return; // Rueda normal: scroll, no tocar.
    // Consumir siempre: Ctrl+rueda/pellizco nunca debe escalar la interfaz.
    e.preventDefault();
    const over = handlers.isDocumentTarget(e.target);
    log({ type: 'wheel', ctrlKey: true, deltaY: e.deltaY, consumed: true });
    if (!over) return;
    if (Date.now() - lastGestureAt < GESTURE_WHEEL_WINDOW_MS) return;
    const factor = wheelZoomFactor(e.deltaY);
    if (factor !== 1) {
      log({ type: 'wheel', ctrlKey: true, deltaY: e.deltaY, factor });
      handlers.onZoom(factor);
    }
  };

  const onGestureStart = (e: Event) => {
    // Sin este preventDefault WebKitGTK amplía todo el webview.
    e.preventDefault();
    gestureScale = (e as WebkitGestureEvent).scale || 1;
    lastGestureAt = Date.now();
    log({ type: 'gesture', scale: gestureScale, consumed: true });
  };

  const onGestureChange = (e: Event) => {
    e.preventDefault();
    const scale = (e as WebkitGestureEvent).scale || 1;
    const factor = gestureZoomFactor(gestureScale, scale);
    gestureScale = scale;
    lastGestureAt = Date.now();
    log({ type: 'gesture', scale, factor, consumed: true });
    if (factor !== 1 && handlers.isDocumentTarget(e.target)) handlers.onZoom(factor);
  };

  const onGestureEnd = (e: Event) => {
    e.preventDefault();
    lastGestureAt = Date.now();
    log({ type: 'gesture', scale: gestureScale, consumed: true });
  };

  /**
   * Pulsaciones de dos dedos (pantallas táctiles y algunos trackpads): se
   * consumen siempre para que el motor no escale la interfaz; sobre el PDF se
   * convierten en zoom del documento, con suavizado y límites.
   */
  const onTouchStart = (e: TouchEvent) => {
    if (e.touches.length !== 2) return;
    e.preventDefault();
    touchDist = touchDistance(e.touches[0], e.touches[1]);
    touchSmoothDist = touchDist;
    lastGestureAt = Date.now();
    log({ type: 'touch', scale: 1, consumed: true });
  };

  const onTouchMove = (e: TouchEvent) => {
    if (e.touches.length !== 2) return;
    e.preventDefault();
    const raw = touchDistance(e.touches[0], e.touches[1]);
    touchSmoothDist = smoothPinchDistance(touchSmoothDist, raw);
    const factor = gestureZoomFactor(touchDist, touchSmoothDist);
    touchDist = touchSmoothDist;
    lastGestureAt = Date.now();
    log({ type: 'touch', scale: touchDist, factor, consumed: true });
    if (factor !== 1 && handlers.isDocumentTarget(e.target)) handlers.onZoom(factor);
  };

  const onTouchEnd = (e: TouchEvent) => {
    if (e.touches.length > 0) return; // Sigue el gesto (queda un dedo).
    if (touchDist === 0) return; // No era un pellizco.
    e.preventDefault();
    touchDist = 0;
    touchSmoothDist = 0;
    lastGestureAt = Date.now();
    log({ type: 'touch', consumed: true });
  };

  win.addEventListener('wheel', onWheel, { passive: false, capture: true });
  win.addEventListener('gesturestart', onGestureStart, { passive: false, capture: true });
  win.addEventListener('gesturechange', onGestureChange, { passive: false, capture: true });
  win.addEventListener('gestureend', onGestureEnd, { passive: false, capture: true });
  win.addEventListener('touchstart', onTouchStart, { passive: false, capture: true });
  win.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
  win.addEventListener('touchend', onTouchEnd, { passive: false, capture: true });
  win.addEventListener('touchcancel', onTouchEnd, { passive: false, capture: true });

  return () => {
    win.removeEventListener('wheel', onWheel, { capture: true });
    win.removeEventListener('gesturestart', onGestureStart, { capture: true });
    win.removeEventListener('gesturechange', onGestureChange, { capture: true });
    win.removeEventListener('gestureend', onGestureEnd, { capture: true });
    win.removeEventListener('touchstart', onTouchStart, { capture: true });
    win.removeEventListener('touchmove', onTouchMove, { capture: true });
    win.removeEventListener('touchend', onTouchEnd, { capture: true });
    win.removeEventListener('touchcancel', onTouchEnd, { capture: true });
  };
}

/** Teclas de zoom nativo del webview (Ctrl++, Ctrl+-, Ctrl+0 y variantes). */
const ZOOM_HOTKEY_KEYS = new Set(['+', '-', '=', '0', '_', ')']);

/**
 * Impide el zoom NATIVO del webview con Ctrl++, Ctrl+- y Ctrl+0.
 *
 * El zoom del documento lo siguen disparando los comandos `doc.zoomIn`,
 * `doc.zoomOut` y `doc.zoomReset` (atajos ya registrados en GLOBAL_SHORTCUTS);
 * aquí solo se bloquea la acción por defecto del motor, que en WebKitGTK escala
 * toda la interfaz. Se aplica en captura y en cualquier contexto (incluido al
 * escribir y en Markdown): la interfaz jamás cambia de tamaño.
 */
export function wireZoomHotkeyGuard(
  win: Window,
  onEvent?: (info: ZoomEventInfo) => void,
): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (!e.ctrlKey || e.altKey) return;
    if (!ZOOM_HOTKEY_KEYS.has(e.key)) return;
    e.preventDefault();
    onEvent?.({ type: 'hotkey', ctrlKey: true, consumed: true });
  };
  win.addEventListener('keydown', onKeyDown, { capture: true });
  return () => win.removeEventListener('keydown', onKeyDown, { capture: true });
}
