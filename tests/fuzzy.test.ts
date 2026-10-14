/** Pruebas de coincidencia difusa de la paleta de comandos. */

import { describe, expect, it } from 'vitest';
import { fuzzyScore, rankItems } from '../src/core/fuzzy';

describe('fuzzyScore', () => {
  it('devuelve null si falta alguna letra', () => {
    expect(fuzzyScore('zzz', 'Abrir documento')).toBeNull();
  });

  it('encuentra subsecuencias y premia el prefijo', () => {
    const exact = fuzzyScore('abrir', 'Abrir documento');
    const later = fuzzyScore('abrir', 'Cerrar y abrir');
    expect(exact).not.toBeNull();
    expect(later).not.toBeNull();
    expect(exact!.score).toBeGreaterThan(later!.score);
  });

  it('consulta vacía no filtra', () => {
    expect(fuzzyScore('', 'cualquier cosa')).toEqual({ score: 0, indices: [] });
  });

  it('devuelve las posiciones coincidentes', () => {
    const res = fuzzyScore('abc', 'a-b-c');
    expect(res?.indices).toEqual([0, 2, 4]);
  });
});

describe('rankItems', () => {
  const items = ['Abrir documento', 'Abrir carpeta', 'Cambiar tema', 'Cerrar pestaña'];

  it('conserva el orden con consulta vacía', () => {
    expect(rankItems('', items, (s) => s)).toEqual(items);
  });

  it('ordena por relevancia', () => {
    const res = rankItems('abrir', items, (s) => s);
    expect(res.slice(0, 2)).toEqual(['Abrir documento', 'Abrir carpeta']);
    expect(res).toHaveLength(2);
  });
});
