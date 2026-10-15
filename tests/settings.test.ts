/** Pruebas de los ajustes: normalización, tipografía y atajos configurables. */

import { describe, expect, it } from 'vitest';
import {
  EDITOR_FONT_SIZE,
  PREVIEW_FONT_SIZE,
  defaultSettings,
  fontStack,
  normalizeSettings,
  EDITOR_FONTS,
  PREVIEW_FONTS,
} from '../src/core/settings';
import {
  GLOBAL_SHORTCUTS,
  comboFor,
  conflictFor,
  effectiveShortcutMap,
  findShortcutConflicts,
  formatCombo,
  reassignShortcut,
  resetShortcutOverrides,
  resolveShortcut,
  sanitizeShortcutOverrides,
} from '../src/core/shortcuts';
import { defaultState, parseState, serializeState } from '../src/core/state';

describe('normalizeSettings', () => {
  it('devuelve los valores por defecto con datos ausentes o corruptos', () => {
    expect(normalizeSettings(null)).toEqual(defaultSettings());
    expect(normalizeSettings('no es json')).toEqual(defaultSettings());
    expect(normalizeSettings({ editorFontSize: 'grande' }).editorFontSize).toBe(
      EDITOR_FONT_SIZE.default,
    );
  });

  it('el autoguardado en el archivo está desactivado por defecto', () => {
    expect(defaultSettings().autoSaveToFile).toBe(false);
    expect(normalizeSettings({ autoSaveToFile: false }).autoSaveToFile).toBe(false);
    expect(normalizeSettings({ autoSaveToFile: true }).autoSaveToFile).toBe(true);
    expect(normalizeSettings({ autoSaveToFile: 'sí' }).autoSaveToFile).toBe(false);
  });

  it('recorta tamaños de fuente fuera de rango', () => {
    expect(normalizeSettings({ editorFontSize: 999 }).editorFontSize).toBe(EDITOR_FONT_SIZE.max);
    expect(normalizeSettings({ editorFontSize: 1 }).editorFontSize).toBe(EDITOR_FONT_SIZE.min);
    expect(normalizeSettings({ previewFontSize: 999 }).previewFontSize).toBe(PREVIEW_FONT_SIZE.max);
  });

  it('solo acepta fuentes y acentos conocidos', () => {
    expect(normalizeSettings({ editorFont: 'wingdings' }).editorFont).toBe('');
    expect(normalizeSettings({ previewFont: 'mono' }).previewFont).toBe('mono');
    expect(normalizeSettings({ accent: 'neón' }).accent).toBe('blue');
    expect(normalizeSettings({ accent: 'green' }).accent).toBe('green');
  });

  it('sanea las reasignaciones de atajos', () => {
    const s = normalizeSettings({
      shortcutOverrides: { 'file.open': 'Ctrl+d', 'doc.find': 42, 'x.y': '   ' },
    });
    expect(s.shortcutOverrides).toEqual({ 'file.open': 'Ctrl+d' });
    expect(normalizeSettings({ shortcutOverrides: { 'tab.close': null } }).shortcutOverrides).toEqual({
      'tab.close': null,
    });
  });

  it('las fuentes por defecto dejan usar la tipografía de Vela', () => {
    expect(fontStack('', EDITOR_FONTS)).toBe('');
    expect(fontStack('', PREVIEW_FONTS)).toBe('');
    expect(fontStack('mono', EDITOR_FONTS)).toContain('monospace');
    expect(fontStack('desconocida', PREVIEW_FONTS)).toBe('');
  });
});

describe('ajustes en el estado persistido', () => {
  it('los ajustes sobreviven a la serialización del estado', () => {
    const s = defaultState();
    s.settings = normalizeSettings({
      editorFontSize: 18,
      accent: 'plum',
      autoSaveToFile: true,
      shortcutOverrides: { 'tab.close': 'Ctrl+e' },
    });
    const round = parseState(serializeState(s));
    expect(round.settings.editorFontSize).toBe(18);
    expect(round.settings.accent).toBe('plum');
    expect(round.settings.autoSaveToFile).toBe(true);
    expect(round.settings.shortcutOverrides).toEqual({ 'tab.close': 'Ctrl+e' });
  });

  it('un estado viejo (sin ajustes) conserva los valores por defecto', () => {
    const legacy = JSON.stringify({ version: 1, theme: 'dark', recents: [], favorites: [], session: [] });
    const parsed = parseState(legacy);
    expect(parsed.theme).toBe('dark');
    expect(parsed.settings).toEqual(defaultSettings());
  });
});

describe('atajos configurables', () => {
  it('sin reasignaciones manda el valor por defecto', () => {
    expect(comboFor('file.open')).toBe('Ctrl+o');
    expect(comboFor('file.open', {})).toBe('Ctrl+o');
    expect(comboFor('comando.inexistente')).toBeNull();
    expect(comboFor('file.open', { 'file.open': 'Ctrl+d' })).toBe('Ctrl+d');
    expect(comboFor('file.open', { 'file.open': null })).toBeNull();
  });

  it('los atajos por defecto apuntan a los ids de comando reales', () => {
    // Regresión: antes apuntaban a «doc.save»/«doc.saveAs», que no existen
    // (los comandos reales son «file.save»/«file.saveAs») y Ctrl+S no hacía nada.
    expect(comboFor('file.save')).toBe('Ctrl+s');
    expect(comboFor('file.saveAs')).toBe('Ctrl+Shift+s');
    const targets = Object.values(GLOBAL_SHORTCUTS);
    expect(targets).not.toContain('doc.save');
    expect(targets).not.toContain('doc.saveAs');
    for (const id of targets) expect(id).toMatch(/^[a-z]+\.[A-Za-z0-9]+$/);
  });

  it('las reasignaciones sustituyen también al combo por defecto', () => {
    const map = effectiveShortcutMap({ 'file.open': 'Ctrl+d' });
    expect(map['Ctrl+d']).toBe('file.open');
    expect(map['Ctrl+o']).toBeUndefined();
  });

  it('detecta el comando que ya usa un combo (conflicto)', () => {
    expect(conflictFor('doc.find', 'Ctrl+o')).toBe('file.open');
    expect(conflictFor('file.open', 'Ctrl+o')).toBeNull();
    expect(conflictFor('doc.find', 'Ctrl+Alt+q')).toBeNull();
    // Con la reasignación, el conflicto se ve desde el nuevo mapa.
    expect(conflictFor('doc.find', 'Ctrl+d', { 'file.open': 'Ctrl+d' })).toBe('file.open');
  });

  it('reasignar con conflicto desplaza al otro comando', () => {
    const { overrides, displaced } = reassignShortcut({}, 'doc.find', 'Ctrl+o');
    expect(displaced).toBe('file.open');
    expect(overrides['file.open']).toBeNull();
    expect(overrides['doc.find']).toBe('Ctrl+o');
  });

  it('reasignar a un combo libre no desplaza a nadie', () => {
    const { overrides, displaced } = reassignShortcut({ 'doc.find': 'Ctrl+d' }, 'doc.print', 'Ctrl+e');
    expect(displaced).toBeNull();
    expect(overrides).toEqual({ 'doc.find': 'Ctrl+d', 'doc.print': 'Ctrl+e' });
  });

  it('quitar atajo y restablecer valores por defecto', () => {
    const { overrides } = reassignShortcut({}, 'doc.find', null);
    expect(overrides['doc.find']).toBeNull();
    expect(comboFor('doc.find', overrides)).toBeNull();
    expect(resetShortcutOverrides()).toEqual({});
    expect(comboFor('doc.find', resetShortcutOverrides())).toBe('Ctrl+f');
  });

  it('el mapa vigente no tiene conflictos salvo que se fuerzen', () => {
    expect(findShortcutConflicts()).toEqual([]);
    const forced = { 'file.open': 'Ctrl+k' };
    const conflicts = findShortcutConflicts(forced);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].commandIds).toContain('palette.open');
  });

  it('sanitizeShortcutOverrides descarta basura y comandos desconocidos', () => {
    expect(sanitizeShortcutOverrides(null)).toEqual({});
    expect(
      sanitizeShortcutOverrides({ 'a b': 'Ctrl+x', ok: 7, otro: 'F5', raro: 'con espacios' }, (id) =>
        ['ok', 'otro', 'raro'].includes(id),
      ),
    ).toEqual({ otro: 'F5' });
  });

  it('resolveShortcut respeta las reasignaciones del usuario', () => {
    const keyEvent = {
      key: 'd',
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
    } as KeyboardEvent;
    expect(resolveShortcut(keyEvent, undefined, { 'file.open': 'Ctrl+d' })).toBe('file.open');
    expect(resolveShortcut(keyEvent, undefined, {})).toBeNull();
  });

  it('formatCombo muestra las combinaciones de forma legible', () => {
    expect(formatCombo('Ctrl+Shift+p')).toBe('Ctrl+Mayús+P');
    expect(formatCombo('Ctrl+o')).toBe('Ctrl+O');
    expect(formatCombo('Ctrl++')).toBe('Ctrl++');
    expect(formatCombo('Ctrl+,')).toBe('Ctrl+,');
    expect(formatCombo('Tab')).toBe('Tab');
    expect(formatCombo('Ctrl+Space')).toBe('Ctrl+Espacio');
  });
});
