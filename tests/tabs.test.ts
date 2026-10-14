/** Pruebas de la lógica de pestañas. */

import { describe, expect, it } from 'vitest';
import { createTab, closeTab, findIndexByFile, moveTab, nextIndex, syncTabCounter } from '../src/core/tabs';

const pdf = (fileId: string, name = 'a.pdf') =>
  createTab({ fileId, name, kind: 'pdf' });

describe('createTab', () => {
  it('crea pestañas con identificadores únicos y estado inicial', () => {
    const a = pdf('x.pdf');
    const b = pdf('y.pdf');
    expect(a.id).not.toBe(b.id);
    expect(a.status).toBe('loading');
    expect(a.dirty).toBe(false);
    expect(a.mdMode).toBe('split');
    expect(a.page).toBe(1);
  });

  it('marca como sin guardar si llega borrador', () => {
    const t = createTab({ fileId: 'n.md', name: 'n.md', kind: 'md', draft: '# hola' });
    expect(t.dirty).toBe(true);
    expect(t.draft).toBe('# hola');
  });
});

describe('closeTab / moveTab / nextIndex', () => {
  it('cierra y recalcula el índice activo', () => {
    const tabs = [pdf('1'), pdf('2'), pdf('3')];
    const res = closeTab(tabs, tabs[1].id);
    expect(res.tabs).toHaveLength(2);
    expect(res.activeIndex).toBe(1);
    expect(res.removed.fileId).toBe('2');
  });

  it('reordena pestañas', () => {
    const tabs = [pdf('1'), pdf('2'), pdf('3')];
    const moved = moveTab(tabs, 0, 2);
    expect(moved.map((t) => t.fileId)).toEqual(['2', '3', '1']);
  });

  it('ignora movimientos inválidos', () => {
    const tabs = [pdf('1'), pdf('2')];
    expect(moveTab(tabs, 0, 0)).toBe(tabs);
    expect(moveTab(tabs, 5, 0)).toBe(tabs);
  });

  it('cicla entre pestañas', () => {
    expect(nextIndex(0, 3, 1)).toBe(1);
    expect(nextIndex(2, 3, 1)).toBe(0);
    expect(nextIndex(0, 3, -1)).toBe(2);
    expect(nextIndex(0, 0, 1)).toBe(0);
  });
});

describe('utilidades', () => {
  it('localiza por archivo', () => {
    const tabs = [pdf('a'), pdf('b')];
    expect(findIndexByFile(tabs, 'b')).toBe(1);
    expect(findIndexByFile(tabs, 'zz')).toBe(-1);
  });

  it('sincroniza el contador tras restaurar', () => {
    const restored = [pdf('a'), pdf('b')];
    syncTabCounter(restored);
    const fresh = pdf('c');
    expect(Number(fresh.id.slice(1))).toBeGreaterThan(2);
  });
});
