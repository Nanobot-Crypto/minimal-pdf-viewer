/** Coincidencia difusa para la paleta de comandos. Puro y testeable. */

export interface FuzzyResult {
  score: number;
  indices: number[];
}

/**
 * Devuelve un score (mayor = mejor) y las posiciones coincidentes en `text`.
 * Coincidencia de subsecuencia con bonus por prefijo, palabra y contigüidad.
 */
export function fuzzyScore(query: string, text: string): FuzzyResult | null {
  const q = query.trim().toLowerCase();
  if (!q) return { score: 0, indices: [] };
  const t = text.toLowerCase();
  const indices: number[] = [];
  let score = 0;
  let ti = 0;
  let prev = -2;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    if (ch === ' ') continue;
    const found = t.indexOf(ch, ti);
    if (found < 0) return null;
    indices.push(found);
    if (found === prev + 1) score += 6;
    if (found === 0) score += 10;
    else if (/[\s\-_/·]/.test(t[found - 1] ?? '')) score += 8;
    score += 1;
    prev = found;
    ti = found + 1;
  }
  // A menor longitud del texto, más relevante.
  score += Math.max(0, 12 - Math.floor(text.length / 6));
  return { score, indices };
}

export function rankItems<T>(query: string, items: T[], getText: (item: T) => string): T[] {
  const q = query.trim();
  if (!q) return items.slice();
  const scored: { item: T; score: number }[] = [];
  for (const item of items) {
    const res = fuzzyScore(q, getText(item));
    if (res) scored.push({ item, score: res.score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.item);
}
