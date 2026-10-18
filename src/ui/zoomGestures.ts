/**
 * Zoom con el pellizco del trackpad y con la rueda + Ctrl.
 *
 * En WebKitGTK (Tauri sobre Linux) el pellizco amplía TODO el webview si la
 * página no consume el gesto (desaparecen la barra superior y la lateral); en
 * Chromium el pellizco llega como eventos `wheel` con `ctrlKey`. Aquí ambos se
 * consumen SIEMPRE con `preventDefault` (listeners no pasivos): la interfaz
 * nunca debe escalarse. Solo cuando el gesto cae sobre el documento PDF se
 * convierte en zoom del documento, reutilizando su lógica de zoom con límites.
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

export interface ZoomGestureHandlers {
  /** Aplica el factor de zoom del documento (solo llega cuando procede). */
  onZoom(factor: number): void;
  /** ¿El gesto cae sobre el documento PDF y no sobre el resto de la interfaz? */
  isDocumentTarget(target: EventTarget | null): boolean;
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

  const onWheel = (e: WheelEvent) => {
    if (!e.ctrlKey) return; // Rueda normal: scroll, no tocar.
    // Consumir siempre: Ctrl+rueda/pellizco nunca debe escalar la interfaz.
    e.preventDefault();
    if (!handlers.isDocumentTarget(e.target)) return;
    if (Date.now() - lastGestureAt < GESTURE_WHEEL_WINDOW_MS) return;
    const factor = wheelZoomFactor(e.deltaY);
    if (factor !== 1) handlers.onZoom(factor);
  };

  const onGestureStart = (e: Event) => {
    // Sin este preventDefault WebKitGTK amplía todo el webview.
    e.preventDefault();
    gestureScale = (e as WebkitGestureEvent).scale || 1;
    lastGestureAt = Date.now();
  };

  const onGestureChange = (e: Event) => {
    e.preventDefault();
    const scale = (e as WebkitGestureEvent).scale || 1;
    const factor = gestureZoomFactor(gestureScale, scale);
    gestureScale = scale;
    lastGestureAt = Date.now();
    if (factor !== 1 && handlers.isDocumentTarget(e.target)) handlers.onZoom(factor);
  };

  const onGestureEnd = (e: Event) => {
    e.preventDefault();
    lastGestureAt = Date.now();
  };

  win.addEventListener('wheel', onWheel, { passive: false, capture: true });
  win.addEventListener('gesturestart', onGestureStart, { passive: false, capture: true });
  win.addEventListener('gesturechange', onGestureChange, { passive: false, capture: true });
  win.addEventListener('gestureend', onGestureEnd, { passive: false, capture: true });

  return () => {
    win.removeEventListener('wheel', onWheel, { capture: true });
    win.removeEventListener('gesturestart', onGestureStart, { capture: true });
    win.removeEventListener('gesturechange', onGestureChange, { capture: true });
    win.removeEventListener('gestureend', onGestureEnd, { capture: true });
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
export function wireZoomHotkeyGuard(win: Window): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (!e.ctrlKey || e.altKey) return;
    if (!ZOOM_HOTKEY_KEYS.has(e.key)) return;
    e.preventDefault();
  };
  win.addEventListener('keydown', onKeyDown, { capture: true });
  return () => win.removeEventListener('keydown', onKeyDown, { capture: true });
}
