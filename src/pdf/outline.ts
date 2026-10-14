/** Índice (outline) del PDF resuelto a páginas. */

import type { PDFDocumentProxy } from 'pdfjs-dist';

export interface OutlineNode {
  title: string;
  page: number | null;
  children: OutlineNode[];
}

interface RawOutlineItem {
  title: string;
  dest: string | unknown[] | null;
  items?: RawOutlineItem[];
}

export async function loadOutline(doc: PDFDocumentProxy): Promise<OutlineNode[]> {
  const raw = (await doc.getOutline()) as RawOutlineItem[] | null;
  if (!raw?.length) return [];
  const resolveDest = async (dest: RawOutlineItem['dest']): Promise<number | null> => {
    try {
      let d: unknown = dest;
      if (typeof d === 'string') d = await doc.getDestination(d);
      if (!Array.isArray(d) || !d.length) return null;
      const ref = d[0];
      if (ref && typeof ref === 'object' && 'num' in (ref as object)) {
        return (await doc.getPageIndex(ref as never)) + 1;
      }
      if (typeof ref === 'number') return ref + 1;
      return null;
    } catch {
      return null;
    }
  };
  const build = async (items: RawOutlineItem[]): Promise<OutlineNode[]> => {
    const out: OutlineNode[] = [];
    for (const it of items) {
      out.push({
        title: it.title?.trim() || '(sin título)',
        page: await resolveDest(it.dest),
        children: it.items?.length ? await build(it.items) : [],
      });
    }
    return out;
  };
  return build(raw);
}
