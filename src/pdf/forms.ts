/**
 * Formularios AcroForm: detección y guardado de una copia rellenada.
 *
 * El relleno ocurre sobre el propio visor (pdf.js pinta los widgets y registra
 * los valores en `annotationStorage`); aquí solo se detectan los campos y se
 * serializa una copia del PDF con esos valores. El archivo original nunca se
 * modifica: escribir sobre él exige confirmación explícita del usuario.
 */

import type { PDFDocumentProxy } from 'pdfjs-dist';

export interface FormFieldInfo {
  /** Identificador de la anotación (clave de `annotationStorage`). */
  id: string;
  fieldName: string;
  /** Tipo de campo PDF: Tx, Btn, Ch (y Sig). */
  type: string;
  page: number;
}

const FIELD_TYPES: Record<string, string> = {
  Tx: 'texto',
  Btn: 'casilla / opción',
  Ch: 'lista',
  Sig: 'firma',
};

export function fieldTypeName(type: string): string {
  return FIELD_TYPES[type] ?? type ?? 'campo';
}

/** Campos de formulario del documento (vacío si no es un PDF rellenable). */
export async function listFormFields(doc: PDFDocumentProxy): Promise<FormFieldInfo[]> {
  const out: FormFieldInfo[] = [];
  const seen = new Set<string>();
  for (let p = 1; p <= doc.numPages; p++) {
    let annotations: { id?: string; subtype?: string; fieldType?: string; fieldName?: string }[] = [];
    try {
      annotations = (await doc.getPage(p).then((page) =>
        page.getAnnotations({ intent: 'display' }),
      )) as never;
    } catch {
      continue;
    }
    for (const a of annotations) {
      if (a.subtype !== 'Widget') continue;
      const fieldName = a.fieldName || a.id || '';
      if (!fieldName || seen.has(fieldName)) continue;
      seen.add(fieldName);
      out.push({ id: a.id ?? fieldName, fieldName, type: a.fieldType ?? '', page: p });
    }
  }
  return out;
}

export async function hasFormFields(doc: PDFDocumentProxy): Promise<boolean> {
  return (await listFormFields(doc)).length > 0;
}

/**
 * Valores rellenos actualmente en el visor (`annotationStorage` de pdf.js),
 * con el nombre de campo para poder copiarlos a una copia con pdf-lib.
 */
export async function collectFormValues(doc: PDFDocumentProxy): Promise<{
  id: string;
  fieldName: string;
  type: string;
  value: unknown;
}[]> {
  const fields = await listFormFields(doc);
  const storage = doc.annotationStorage.getAll() as Record<string, unknown>;
  return fields
    .filter((f) => storage[f.id] !== undefined)
    .map((f) => ({ id: f.id, fieldName: f.fieldName, type: f.type, value: storage[f.id] }));
}

/**
 * Serializa el documento con los valores del `annotationStorage` de pdf.js.
 * El resultado es un PDF completo e independiente (copia rellenada).
 */
export async function saveFilledPdf(doc: PDFDocumentProxy): Promise<Uint8Array> {
  return doc.saveDocument();
}

/** Nombre propuesto para la copia rellenada (nunca el del original). */
export function filledCopyName(originalName: string): string {
  const base = originalName.replace(/\.pdf$/i, '');
  return `${base}-relleno.pdf`;
}
