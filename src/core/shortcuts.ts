/** Atajos de teclado → comandos. */

export type Combo = string; // p. ej. "Ctrl+K", "Ctrl+Shift+P", "Ctrl+ArrowRight"

export function comboFromEvent(e: KeyboardEvent): Combo {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  let key = e.key;
  if (key === ' ') key = 'Space';
  if (key.length === 1) key = key.toLowerCase();
  parts.push(key);
  return parts.join('+');
}

/** Atajos globales. Cada aplicación puede registrar más en caliente. */
export const GLOBAL_SHORTCUTS: Record<Combo, string> = {
  'Ctrl+o': 'file.open',
  'Ctrl+k': 'palette.open',
  'Ctrl+Shift+p': 'palette.open',
  'Ctrl+b': 'view.sidebar',
  'Ctrl+t': 'view.theme',
  'Ctrl+w': 'tab.close',
  'Ctrl+Tab': 'tab.next',
  'Ctrl+Shift+Tab': 'tab.prev',
  'Ctrl+f': 'doc.find',
  'Ctrl+s': 'doc.save',
  'Ctrl+Shift+s': 'doc.saveAs',
  'Ctrl+p': 'doc.print',
  'Ctrl++': 'doc.zoomIn',
  'Ctrl+-': 'doc.zoomOut',
  'Ctrl+0': 'doc.zoomReset',
  'Ctrl+1': 'tab.1',
  'Ctrl+2': 'tab.2',
  'Ctrl+3': 'tab.3',
  'Ctrl+4': 'tab.4',
  'Ctrl+5': 'tab.5',
  'Ctrl+6': 'tab.6',
  'Ctrl+7': 'tab.7',
  'Ctrl+8': 'tab.8',
  'Ctrl+9': 'tab.9',
};

export function resolveShortcut(e: KeyboardEvent, extra?: Record<Combo, string>): string | null {
  const combo = comboFromEvent(e).toLowerCase();
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (k.toLowerCase() === combo) return v;
    }
  }
  for (const [k, v] of Object.entries(GLOBAL_SHORTCUTS)) {
    if (k.toLowerCase() === combo) return v;
  }
  return null;
}

/** Combos definidos dos veces: útil para la documentación y las pruebas. */
export function shortcutConflicts(map: Record<Combo, string> = GLOBAL_SHORTCUTS): Combo[] {
  const seen = new Map<string, Combo[]>();
  for (const [combo, cmd] of Object.entries(map)) {
    const key = combo.toLowerCase();
    const list = seen.get(key) ?? [];
    list.push(cmd);
    seen.set(key, list);
  }
  const conflicts: Combo[] = [];
  for (const [, cmds] of seen) if (new Set(cmds).size > 1) conflicts.push(cmds.join(','));
  return conflicts;
}
