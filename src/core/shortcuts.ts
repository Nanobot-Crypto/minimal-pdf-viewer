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

/**
 * Atajos por defecto (combo → id de comando).
 *
 * Cómo registrar un atajo nuevo (tandas futuras):
 *  1. Añade el comando en `App.commands()` (id, título, sección, run).
 *  2. Si quieres una combinación por defecto, añade aquí una línea
 *     `'Ctrl+x': 'mi.comando'`. Sin línea, el comando queda sin atajo, pero
 *     sigue apareciendo en Ajustes → Atajos de teclado para asignarle uno.
 *  3. Si el comando debe funcionar mientras se escribe en un campo, añade su
 *     id al conjunto `TYPING_ALLOWED` de src/app.ts.
 *
 * El formato de `Combo` sale de `comboFromEvent`: modificadores en orden
 * Ctrl, Alt, Shift y la tecla final (`Space`, `Tab`, `ArrowRight`, `p`, `,`…).
 *
 * Ver docs/SHORTCUTS.md para el detalle completo.
 */
export const GLOBAL_SHORTCUTS: Record<Combo, string> = {
  'Ctrl+o': 'file.open',
  'Ctrl+k': 'palette.open',
  'Ctrl+Shift+p': 'palette.open',
  'Ctrl+b': 'view.sidebar',
  'Ctrl+t': 'view.theme',
  'Ctrl+,': 'settings.open',
  'Ctrl+w': 'tab.close',
  'Ctrl+Tab': 'tab.next',
  'Ctrl+Shift+Tab': 'tab.prev',
  'Ctrl+f': 'doc.find',
  'Ctrl+s': 'file.save',
  'Ctrl+Shift+s': 'file.saveAs',
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

/**
 * Reasignaciones del usuario (Ajustes → Atajos de teclado):
 * id de comando → combo. `null` deja el comando sin atajo.
 */
export type ShortcutOverrides = Record<string, string | null>;

/** Clave de comparación de combos (no distingue mayúsculas). */
function comboKey(combo: Combo): string {
  return combo.toLowerCase();
}

/** Combos por defecto, saneados: claves de comando → combo. */
export function defaultComboFor(commandId: string): Combo | null {
  for (const [combo, id] of Object.entries(GLOBAL_SHORTCUTS)) {
    if (id === commandId) return combo;
  }
  return null;
}

/** Combo vigente de un comando (con las reasignaciones del usuario). */
export function comboFor(commandId: string, overrides: ShortcutOverrides = {}): Combo | null {
  if (Object.prototype.hasOwnProperty.call(overrides, commandId)) return overrides[commandId];
  return defaultComboFor(commandId);
}

/**
 * Todos los vínculos combo → comando (por defecto + reasignaciones), incluidos
 * los posibles conflictos. Es la fuente de verdad para detectar colisiones.
 */
export function allBindings(overrides: ShortcutOverrides = {}): { combo: Combo; commandId: string }[] {
  const out: { combo: Combo; commandId: string }[] = [];
  for (const [combo, id] of Object.entries(GLOBAL_SHORTCUTS)) {
    if (Object.prototype.hasOwnProperty.call(overrides, id)) continue;
    out.push({ combo, commandId: id });
  }
  for (const [id, combo] of Object.entries(overrides)) {
    if (!combo) continue;
    out.push({ combo, commandId: id });
  }
  return out;
}

/**
 * Mapa combo → comando teniendo en cuenta las reasignaciones. Es lo que se
 * consulta al pulsar una tecla.
 */
export function effectiveShortcutMap(overrides: ShortcutOverrides = {}): Record<Combo, string> {
  const out: Record<Combo, string> = {};
  for (const { combo, commandId } of allBindings(overrides)) out[combo] = commandId;
  return out;
}

export function resolveShortcut(
  e: KeyboardEvent,
  extra?: Record<Combo, string>,
  overrides?: ShortcutOverrides,
): string | null {
  const combo = comboKey(comboFromEvent(e));
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (comboKey(k) === combo) return v;
    }
  }
  for (const [k, v] of Object.entries(effectiveShortcutMap(overrides))) {
    if (comboKey(k) === combo) return v;
  }
  return null;
}

/** Combos definidos dos veces: útil para la documentación y las pruebas. */
export function shortcutConflicts(map: Record<Combo, string> = GLOBAL_SHORTCUTS): Combo[] {
  const seen = new Map<string, Combo[]>();
  for (const [combo, cmd] of Object.entries(map)) {
    const key = comboKey(combo);
    const list = seen.get(key) ?? [];
    list.push(cmd);
    seen.set(key, list);
  }
  const conflicts: Combo[] = [];
  for (const [, cmds] of seen) if (new Set(cmds).size > 1) conflicts.push(cmds.join(','));
  return conflicts;
}

export interface ShortcutConflict {
  combo: Combo;
  commandIds: string[];
}

/**
 * Conflictos del mapa vigente: el mismo combo asignado a comandos distintos.
 * (Con la interfaz de Ajustes no deberían existir; se detectan igualmente.)
 */
export function findShortcutConflicts(overrides: ShortcutOverrides = {}): ShortcutConflict[] {
  const byCombo = new Map<string, Set<string>>();
  for (const { combo, commandId } of allBindings(overrides)) {
    const key = comboKey(combo);
    const set = byCombo.get(key) ?? new Set<string>();
    set.add(commandId);
    byCombo.set(key, set);
  }
  const out: ShortcutConflict[] = [];
  for (const [key, ids] of byCombo) {
    if (ids.size > 1) out.push({ combo: key, commandIds: [...ids] });
  }
  return out;
}

/**
 * ¿Qué otro comando usa ya este combo? Devuelve su id (o `null` si está libre).
 */
export function conflictFor(
  commandId: string,
  combo: Combo,
  overrides: ShortcutOverrides = {},
): string | null {
  const key = comboKey(combo);
  for (const bind of allBindings(overrides)) {
    if (comboKey(bind.combo) === key && bind.commandId !== commandId) return bind.commandId;
  }
  return null;
}

/**
 * Asigna `combo` a `commandId`. Si otro comando lo usaba, se queda sin atajo
 * («robo» del combo) y se devuelve su id en `displaced` para poder avisar.
 * `combo = null` deja el comando sin atajo.
 */
export function reassignShortcut(
  overrides: ShortcutOverrides,
  commandId: string,
  combo: Combo | null,
): { overrides: ShortcutOverrides; displaced: string | null } {
  const next: ShortcutOverrides = { ...overrides };
  let displaced: string | null = null;
  if (combo) {
    const other = conflictFor(commandId, combo, overrides);
    if (other) {
      displaced = other;
      next[other] = null;
    }
  }
  next[commandId] = combo;
  return { overrides: next, displaced };
}

/** Borra todas las reasignaciones (vuelve a los atajos por defecto). */
export function resetShortcutOverrides(): ShortcutOverrides {
  return {};
}

/**
 * Sanea las reasignaciones guardadas: solo pares id → combo válido (o `null`).
 * Las claves deben coincidir con comandos reales; las desconocidas se ignoran.
 */
export function sanitizeShortcutOverrides(
  raw: unknown,
  isKnownCommand: (commandId: string) => boolean = () => true,
): ShortcutOverrides {
  const out: ShortcutOverrides = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, combo] of Object.entries(raw as Record<string, unknown>)) {
    if (!id || typeof id !== 'string' || !isKnownCommand(id)) continue;
    if (combo === null || combo === '') {
      out[id] = null;
    } else if (typeof combo === 'string' && combo.length <= 32 && !/\s/.test(combo)) {
      out[id] = combo;
    }
  }
  return out;
}

/**
 * Presentación legible de un combo: `Ctrl+Shift+p` → `Ctrl+Mayús+P`.
 * El formato interno no cambia; esto es solo para la interfaz.
 */
export function formatCombo(combo: Combo): string {
  const parts = combo.split('+');
  let key = parts.pop() ?? '';
  // La tecla puede ser «+» misma (p. ej. «Ctrl++»): split deja huecos al final.
  if (key === '' && parts.length && parts[parts.length - 1] === '') {
    key = '+';
    parts.pop();
  }
  const mods = parts.map((p) => {
    const lower = p.toLowerCase();
    if (lower === 'ctrl') return 'Ctrl';
    if (lower === 'alt') return 'Alt';
    if (lower === 'shift') return 'Mayús';
    return p;
  });
  const label = key === 'Space' ? 'Espacio' : key.length === 1 ? key.toUpperCase() : key;
  return [...mods, label].join('+');
}
