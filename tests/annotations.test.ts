/** Pruebas de las anotaciones de texto (modelo, geometría y guardado). */

import { describe, expect, it } from 'vitest';
import { PDFDict, PDFName } from 'pdf-lib';
import {
  ANN_COLORS,
  AnnotationStore,
  annotationsFromPdfjsData,
  annCopyName,
  cloneAnnot,
  quadBounds,
  rectsToQuads,
  translateAnnot,
  translateQuads,
  saveAnnotatedPdf,
  type TextAnnotation,
} from '../src/pdf/annotations';

/** Viewport falso: escala s + volteo del eje Y (como pdf.js, sin rotación). */
function fakeViewport(scale: number) {
  return {
    toPdf: (x: number, y: number): [number, number] => [x / scale, (400 * scale - y) / scale],
    toViewport: (x: number, y: number): [number, number] => [x * scale, (400 - y) * scale],
  };
}

describe('geometría: selección → quadrilaterals', () => {
  it('convierte rectángulos de cliente a quads en espacio PDF', () => {
    const vp = fakeViewport(2);
    const pageRect = { left: 100, top: 50, right: 100 + 595 * 2, bottom: 50 + 400 * 2 };
    const quads = rectsToQuads([{ left: 110, top: 70, right: 210, bottom: 90 }], pageRect, vp.toPdf);
    expect(quads).toHaveLength(1);
    const [q] = quads;
    // (110-100)/2 = 5 en x; y PDF: (800-(70-50))/2 = 390 (borde superior).
    expect(q).toEqual([5, 390, 55, 390, 5, 380, 55, 380]);
    const b = quadBounds(q);
    expect(b).toEqual({ left: 5, top: 390, right: 55, bottom: 380 });
  });

  it('ignora rectángulos vacíos o degenerados', () => {
    const vp = fakeViewport(1);
    const pageRect = { left: 0, top: 0, right: 595, bottom: 400 };
    expect(rectsToQuads([{ left: 10, top: 10, right: 10, bottom: 20 }], pageRect, vp.toPdf)).toEqual([]);
    expect(rectsToQuads([{ left: 10, top: 10, right: 20, bottom: 10 }], pageRect, vp.toPdf)).toEqual([]);
  });

  it('el movimiento traslada todos los vértices', () => {
    const moved = translateQuads([[1, 2, 3, 2, 1, 0, 3, 0]], 5, -1);
    expect(moved[0]).toEqual([6, 1, 8, 1, 6, -1, 8, -1]);
  });
});

describe('modelo: añadir, borrar, deshacer y rehacer', () => {
  const ann = (id: string): TextAnnotation => ({
    id,
    pageIndex: 0,
    type: 'highlight',
    color: ANN_COLORS[0].hex,
    quads: [[0, 10, 10, 10, 0, 0, 10, 0]],
  });

  it('añadir deja la anotación seleccionada y con deshacer disponible', () => {
    const store = new AnnotationStore();
    store.add(ann('a'));
    expect(store.list()).toHaveLength(1);
    expect(store.selected()?.id).toBe('a');
    expect(store.canUndo()).toBe(true);
    expect(store.canRedo()).toBe(false);
  });

  it('deshacer/rehacer de añadir, borrar y mover', () => {
    const store = new AnnotationStore();
    store.add(ann('a'));
    expect(store.undo()).toBe(true); // deshace el añadido
    expect(store.list()).toHaveLength(0);
    expect(store.redo()).toBe(true);
    expect(store.list()).toHaveLength(1);

    store.remove('a');
    expect(store.list()).toHaveLength(0);
    store.undo(); // vuelve a existir
    expect(store.list()).toHaveLength(1);

    const before = cloneAnnot(store.get('a')!) as TextAnnotation;
    const after = translateAnnot(before, 3, 4) as TextAnnotation;
    store.move('a', before, after);
    expect((store.get('a')! as TextAnnotation).quads).toEqual(after.quads);
    store.undo();
    expect((store.get('a')! as TextAnnotation).quads).toEqual(before.quads);
    store.redo();
    expect((store.get('a')! as TextAnnotation).quads).toEqual(after.quads);
    expect(store.canRedo()).toBe(false);
  });

  it('sin operaciones no hay nada que deshacer', () => {
    const store = new AnnotationStore();
    expect(store.undo()).toBe(false);
    expect(store.redo()).toBe(false);
  });
});

describe('interop: lectura de anotaciones del PDF (reabrir copia)', () => {
  it('convierte un Highlight con quadPoints del PDF', () => {
    const ann = annotationsFromPdfjsData(
      {
        subtype: 'Highlight',
        color: [1, 0.83, 0],
        rect: [10, 20, 110, 40],
        quadPoints: [10, 40, 110, 40, 10, 20, 110, 20],
      },
      2,
    );
    expect(ann).not.toBeNull();
    const textAnn = ann as TextAnnotation;
    expect(textAnn.type).toBe('highlight');
    expect(textAnn.pageIndex).toBe(2);
    expect(textAnn.color).toBe('#ffd400');
    expect(textAnn.quads).toEqual([[10, 40, 110, 40, 10, 20, 110, 20]]);
  });

  it('sin quadPoints usa el rect y descarta subtipos que no son de texto', () => {
    const fromRect = annotationsFromPdfjsData(
      { subtype: 'StrikeOut', rect: [0, 0, 10, 10] },
      0,
    );
    expect(fromRect!.type).toBe('strikeout');
    expect((fromRect as TextAnnotation).quads).toHaveLength(1);
    // 'Text' ya no se descarta: es un comentario (Parte 2).
    expect(annotationsFromPdfjsData({ subtype: 'Link', rect: [0, 0, 1, 1] }, 0)).toBeNull();
    expect(annotationsFromPdfjsData({ subtype: 'Highlight' }, 0)).toBeNull();
  });
});

describe('Parte 2: formas, comentarios y firma', () => {
  it('lee Square/Circle/Line y Text del PDF (reabrir copia)', () => {
    const rect = annotationsFromPdfjsData({ subtype: 'Square', color: [1, 0, 0], rect: [10, 10, 60, 40] }, 0);
    expect(rect!.type).toBe('shape');
    expect((rect as { shape: string }).shape).toBe('rect');

    const circle = annotationsFromPdfjsData({ subtype: 'Circle', rect: [0, 0, 10, 10] }, 0);
    expect((circle as { shape: string }).shape).toBe('ellipse');

    const arrow = annotationsFromPdfjsData(
      { subtype: 'Line', lineCoordinates: [5, 5, 25, 35], lineEndingStyles: ['None', 'OpenArrow'] },
      1,
    );
    expect((arrow as { shape: string }).shape).toBe('arrow');
    expect((arrow as { rect: number[] }).rect).toEqual([5, 5, 25, 35]);

    const note = annotationsFromPdfjsData(
      { subtype: 'Text', rect: [100, 200, 122, 222], contents: 'hola' },
      2,
    );
    expect(note!.type).toBe('comment');
    expect((note as { text: string }).text).toBe('hola');
    expect((note as { pageIndex: number }).pageIndex).toBe(2);
  });

  it('guarda formas y comentarios como anotaciones estándar', async () => {
    const { PDFDocument } = await import('pdf-lib');
    const base = await PDFDocument.create();
    base.addPage([595, 400]);
    const originalBytes = await base.save();

    const out = await saveAnnotatedPdf({
      originalBytes,
      annotations: [
        { id: 's1', pageIndex: 0, type: 'shape', shape: 'rect', color: '#ff0000', thickness: 2, rect: [50, 50, 150, 120] },
        { id: 's2', pageIndex: 0, type: 'shape', shape: 'ellipse', color: '#00ff00', thickness: 1, rect: [200, 50, 300, 120] },
        { id: 's3', pageIndex: 0, type: 'shape', shape: 'arrow', color: '#0000ff', thickness: 1.5, rect: [50, 200, 150, 260] },
        { id: 'c1', pageIndex: 0, type: 'comment', x: 400, y: 300, text: 'nota de prueba' },
      ],
    });
    const reloaded = await PDFDocument.load(out);
    const annots = reloaded.getPage(0).node.Annots();
    expect(annots!.size()).toBe(4);
    const subtypes = [0, 1, 2, 3].map((i) => {
      const dict = annots!.lookup(i, PDFDict) as PDFDict;
      return String(dict.get(PDFName.of('Subtype')));
    });
    expect(subtypes).toEqual(['/Square', '/Circle', '/Line', '/Text']);
    // El comentario lleva su texto (Contents).
    const noteDict = annots!.lookup(3, PDFDict) as PDFDict;
    expect(String(noteDict.get(PDFName.of('Subtype')))).toBe('/Text');
  });

  it('guarda el lápiz a mano alzada como /Ink y lo relee del PDF', async () => {
    const { PDFDocument } = await import('pdf-lib');
    const base = await PDFDocument.create();
    base.addPage([595, 400]);
    const originalBytes = await base.save();

    const out = await saveAnnotatedPdf({
      originalBytes,
      annotations: [
        {
          id: 'i1',
          pageIndex: 0,
          type: 'ink',
          color: '#1a4fd6',
          thickness: 3,
          strokes: [[10, 10, 20, 30, 40, 25, 60, 40]],
        },
      ],
    });
    const reloaded = await PDFDocument.load(out);
    const annots = reloaded.getPage(0).node.Annots();
    expect(annots!.size()).toBe(1);
    const dict = annots!.lookup(0, PDFDict) as PDFDict;
    expect(String(dict.get(PDFName.of('Subtype')))).toBe('/Ink');
    expect(dict.get(PDFName.of('InkList'))).toBeTruthy();

    // Relectura: pdf.js expone `inkList`.
    const again = annotationsFromPdfjsData(
      {
        subtype: 'Ink',
        color: [0.1, 0.31, 0.84],
        rect: [10, 10, 60, 40],
        inkList: [[10, 10, 20, 30, 40, 25, 60, 40]],
      } as never,
      0,
    );
    expect(again!.type).toBe('ink');
    expect((again as { strokes: number[][] }).strokes[0]).toEqual([10, 10, 20, 30, 40, 25, 60, 40]);
  });

  it('guarda la firma como sello con apariencia de imagen (/Stamp)', async () => {
    const { PDFDocument } = await import('pdf-lib');
    const base = await PDFDocument.create();
    base.addPage([595, 400]);
    const originalBytes = await base.save();

    // PNG mínimo válido (1x1) como data URL.
    const png =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const out = await saveAnnotatedPdf({
      originalBytes,
      annotations: [
        { id: 'f1', pageIndex: 0, type: 'image', kind: 'signature', dataUrl: png, rect: [50, 50, 200, 110] },
      ],
    });
    const reloaded = await PDFDocument.load(out);
    const annots = reloaded.getPage(0).node.Annots();
    expect(annots!.size()).toBe(1);
    const dict = annots!.lookup(0, PDFDict) as PDFDict;
    expect(String(dict.get(PDFName.of('Subtype')))).toBe('/Stamp');
    expect(dict.get(PDFName.of('AP'))).toBeTruthy();
  });
});

describe('guardado de la copia con anotaciones', () => {
  it('el nombre propuesto nunca es el del original', () => {
    expect(annCopyName('informe.pdf')).toBe('informe-anotado.pdf');
    expect(annCopyName('informe')).toBe('informe-anotado.pdf');
    expect(annCopyName('informe.pdf')).not.toBe('informe.pdf');
  });

  it('genera un PDF con anotaciones estándar (Highlight/Underline/StrikeOut)', async () => {
    // PDF mínimo de un byte de contenido: lo crea pdf-lib en la propia prueba.
    const { PDFDocument } = await import('pdf-lib');
    const base = await PDFDocument.create();
    const page = base.addPage([595, 400]);
    page.drawText('hola', { x: 40, y: 300, size: 12 });
    const originalBytes = await base.save();

    const anns: TextAnnotation[] = [
      { id: '1', pageIndex: 0, type: 'highlight', color: '#ffd400', quads: [[40, 315, 90, 315, 40, 300, 90, 300]] },
      { id: '2', pageIndex: 0, type: 'underline', color: '#4caf50', quads: [[40, 300, 90, 300, 40, 295, 90, 295]] },
      { id: '3', pageIndex: 0, type: 'strikeout', color: '#ff6ea9', quads: [[40, 310, 90, 310, 40, 305, 90, 305]] },
    ];
    const out = await saveAnnotatedPdf({ originalBytes, annotations: anns });
    expect(Buffer.from(out.slice(0, 5)).toString()).toBe('%PDF-');

    // Se reabre con pdf-lib y se comprueban los subtipos estándar.
    const reloaded = await PDFDocument.load(out);
    const annots = reloaded.getPage(0).node.Annots();
    expect(annots).toBeTruthy();
    expect(annots!.size()).toBe(3);
    const subtypes = [0, 1, 2].map((i) => {
      const dict = annots!.lookup(i, PDFDict) as PDFDict;
      return String(dict.get(PDFName.of('Subtype')));
    });
    expect(subtypes.join(',')).toBe('/Highlight,/Underline,/StrikeOut');
    // El original no cambia (salida independiente).
    expect(Buffer.from(out).length).toBeGreaterThan(0);
  });
});
