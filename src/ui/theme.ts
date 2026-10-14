/** Tema claro/oscuro con preferencia de sistema. */

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
