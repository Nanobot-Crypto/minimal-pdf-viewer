/** Pruebas de atajos de teclado. */

import { describe, expect, it } from 'vitest';
import { GLOBAL_SHORTCUTS, comboFromEvent, resolveShortcut, shortcutConflicts } from '../src/core/shortcuts';

function keyEvent(init: Partial<KeyboardEventInit> & { key: string }): KeyboardEvent {
  return {
    key: init.key,
    ctrlKey: Boolean(init.ctrlKey),
    metaKey: Boolean(init.metaKey),
    altKey: Boolean(init.altKey),
    shiftKey: Boolean(init.shiftKey),
  } as KeyboardEvent;
}

describe('comboFromEvent', () => {
  it('normaliza combinaciones', () => {
    expect(comboFromEvent(keyEvent({ key: 'k', ctrlKey: true }))).toBe('Ctrl+k');
    expect(comboFromEvent(keyEvent({ key: 'P', ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+p');
    expect(comboFromEvent(keyEvent({ key: 'Tab', ctrlKey: true }))).toBe('Ctrl+Tab');
    expect(comboFromEvent(keyEvent({ key: 'a' }))).toBe('a');
    expect(comboFromEvent(keyEvent({ key: ' ', ctrlKey: true }))).toBe('Ctrl+Space');
  });
});

describe('resolveShortcut', () => {
  it('resuelve atajos globales y extras', () => {
    expect(resolveShortcut(keyEvent({ key: 'o', ctrlKey: true }))).toBe('file.open');
    expect(resolveShortcut(keyEvent({ key: 'P', ctrlKey: true, shiftKey: true }))).toBe('palette.open');
    expect(resolveShortcut(keyEvent({ key: '=', ctrlKey: true }), { 'Ctrl+=': 'doc.zoomIn' })).toBe(
      'doc.zoomIn',
    );
    expect(resolveShortcut(keyEvent({ key: 'q', ctrlKey: true }))).toBeNull();
  });

  it('no tiene atajos duplicados', () => {
    expect(shortcutConflicts()).toEqual([]);
    expect(shortcutConflicts({ 'Ctrl+a': 'x', 'ctrl+a': 'y' })).toHaveLength(1);
  });

  it('cubre los comandos esenciales', () => {
    const values = Object.values(GLOBAL_SHORTCUTS);
    for (const cmd of ['file.open', 'palette.open', 'doc.find', 'doc.print', 'tab.close']) {
      expect(values).toContain(cmd);
    }
  });
});
