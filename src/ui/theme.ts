/** Tema claro/oscuro, color de acento y tipografía. */

import type { AppSettings } from '../core/settings';
import { EDITOR_FONTS, PREVIEW_FONTS, fontStack, type AccentId } from '../core/settings';

export type ThemePref = 'light' | 'dark' | 'system';

export function resolveTheme(pref: ThemePref): 'light' | 'dark' {
  if (pref !== 'system') return pref;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(pref: ThemePref): 'light' | 'dark' {
  const resolved = resolveTheme(pref);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themePref = pref;
  return resolved;
}

export function watchSystemTheme(onChange: () => void): void {
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', onChange);
}

/** Color de acento (variables CSS por `data-accent`). */
export function applyAccent(accent: AccentId): void {
  document.documentElement.dataset.accent = accent;
}

function setOrUnset(name: string, value: string): void {
  const root = document.documentElement;
  if (value) root.style.setProperty(name, value);
  else root.style.removeProperty(name);
}

/** Tipografía del editor y la previsualización Markdown (variables CSS). */
export function applyTypography(settings: AppSettings): void {
  setOrUnset('--md-editor-font', fontStack(settings.editorFont, EDITOR_FONTS));
  document.documentElement.style.setProperty('--md-editor-size', `${settings.editorFontSize}px`);
  setOrUnset('--md-preview-font', fontStack(settings.previewFont, PREVIEW_FONTS));
  document.documentElement.style.setProperty('--md-preview-size', `${settings.previewFontSize}px`);
}

/** Aplica de golpe todo lo visual que depende de tema y ajustes. */
export function applyAppearance(theme: ThemePref, settings: AppSettings): void {
  applyTheme(theme);
  applyAccent(settings.accent);
  applyTypography(settings);
}
