/**
 * Ajustes de la aplicación: tipografía, apariencia, atajos y autoguardado.
 *
 * Todo es puro y testeable: la interfaz (src/ui/settings.ts) solo edita estos
 * valores y los aplica; la persistencia va en `PersistedState.settings`
 * (vela-state.json / localStorage), igual que el resto del estado.
 */

import type { ShortcutOverrides } from './shortcuts';
import { sanitizeShortcutOverrides } from './shortcuts';

export type AccentId = 'blue' | 'green' | 'teal' | 'plum' | 'orange' | 'red';

export interface AccentChoice {
  id: AccentId;
  label: string;
}

/** Colores de acento ofrecidos (sin recursos externos: valores locales). */
export const ACCENTS: AccentChoice[] = [
  { id: 'blue', label: 'Azul' },
  { id: 'green', label: 'Verde' },
  { id: 'teal', label: 'Turquesa' },
  { id: 'plum', label: 'Ciruela' },
  { id: 'orange', label: 'Naranja' },
  { id: 'red', label: 'Rojo' },
];

/**
 * Color de cada acento en tema claro (solo para las muestras del panel).
 * El valor real de la interfaz vive en src/styles/base.css (`--accent`).
 */
export const ACCENT_HEX: Record<AccentId, string> = {
  blue: '#0b57d0',
  green: '#1a7f4b',
  teal: '#00796b',
  plum: '#6f42c1',
  orange: '#b3541e',
  red: '#c62828',
};

export interface FontChoice {
  /** Identificador persistido. `''` = tipografía predeterminada de Vela. */
  id: string;
  label: string;
  /** Pila CSS. Se usa solo si el usuario elige esta fuente. */
  stack: string;
}

/** Fuentes del editor Markdown (solo pila local: nada de CDN). */
export const EDITOR_FONTS: FontChoice[] = [
  { id: '', label: 'Predeterminada', stack: '' },
  {
    id: 'mono',
    label: 'Monoespaciada',
    stack: "ui-monospace, 'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace",
  },
  { id: 'sans', label: 'Sans (interfaz)', stack: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
  {
    id: 'serif',
    label: 'Serifada',
    stack: "Charter, Georgia, 'Times New Roman', serif",
  },
];

/** Fuentes de la previsualización Markdown. */
export const PREVIEW_FONTS: FontChoice[] = [
  { id: '', label: 'Predeterminada', stack: '' },
  {
    id: 'serif',
    label: 'Serifada (lectura)',
    stack: "Charter, Georgia, 'Times New Roman', serif",
  },
  { id: 'sans', label: 'Sans', stack: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
  {
    id: 'mono',
    label: 'Monoespaciada',
    stack: "ui-monospace, 'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace",
  },
];

export const EDITOR_FONT_SIZE = { min: 10, max: 28, step: 0.5, default: 14 };
export const PREVIEW_FONT_SIZE = { min: 12, max: 30, step: 0.5, default: 16.5 };

export interface AppSettings {
  /** Fuente del editor Markdown (id de EDITOR_FONTS). */
  editorFont: string;
  editorFontSize: number;
  /** Fuente de la previsualización Markdown (id de PREVIEW_FONTS). */
  previewFont: string;
  previewFontSize: number;
  accent: AccentId;
  /**
   * Autoguardado periódico en el propio archivo Markdown. DESACTIVADO por
   * defecto: solo se activa con confirmación explícita del usuario.
   */
  autoSaveToFile: boolean;
  /** Reasignaciones de atajos: id de comando → combo (`null` = sin atajo). */
  shortcutOverrides: ShortcutOverrides;
}

export function defaultSettings(): AppSettings {
  return {
    editorFont: '',
    editorFontSize: EDITOR_FONT_SIZE.default,
    previewFont: '',
    previewFontSize: PREVIEW_FONT_SIZE.default,
    accent: 'blue',
    autoSaveToFile: false,
    shortcutOverrides: {},
  };
}

function clampSize(value: unknown, range: { min: number; max: number; default: number }): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : range.default;
  return Math.min(range.max, Math.max(range.min, n));
}

function validFontId(value: unknown, list: FontChoice[]): string {
  return typeof value === 'string' && list.some((f) => f.id === value) ? value : '';
}

function validAccent(value: unknown): AccentId {
  return ACCENTS.some((a) => a.id === value) ? (value as AccentId) : 'blue';
}

/** Rellena y sanea los ajustes: nunca lanza y nunca deja valores fuera de rango. */
export function normalizeSettings(raw: unknown): AppSettings {
  const d = defaultSettings();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<AppSettings>;
  return {
    editorFont: validFontId(r.editorFont, EDITOR_FONTS),
    editorFontSize: clampSize(r.editorFontSize, EDITOR_FONT_SIZE),
    previewFont: validFontId(r.previewFont, PREVIEW_FONTS),
    previewFontSize: clampSize(r.previewFontSize, PREVIEW_FONT_SIZE),
    accent: validAccent(r.accent),
    autoSaveToFile: r.autoSaveToFile === true,
    shortcutOverrides: sanitizeShortcutOverrides(r.shortcutOverrides),
  };
}

/** Pila CSS de una fuente elegida (vacía = usar la predeterminada). */
export function fontStack(id: string, list: FontChoice[]): string {
  return list.find((f) => f.id === id)?.stack ?? '';
}
