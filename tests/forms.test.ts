/** Pruebas de formularios AcroForm: fixture, nombres de copia y relleno. */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFCheckBox, PDFDropdown, PDFOptionList, PDFRadioGroup, PDFTextField } from 'pdf-lib';
import { filledCopyName } from '../src/pdf/forms';

const fixture = path.join(process.cwd(), 'fixtures', 'formulario.pdf');

async function loadFixture(): Promise<PDFDocument> {
  // `new Uint8Array(...)` evita mezclar el Buffer de Node con el Uint8Array
  // del realm de jsdom (pdf-lib rechaza instancias de otro realm).
  return PDFDocument.load(new Uint8Array(fs.readFileSync(fixture)));
}

describe('fixtures/formulario.pdf', () => {
  it('existe y tiene los campos AcroForm esperados', async () => {
    const doc = await loadFixture();
    const form = doc.getForm();
    const names = form.getFields().map((f) => f.getName()).sort();
    expect(names).toEqual(['acepto', 'ciudad', 'email', 'envio', 'intereses', 'nombre']);
    // Los getters lanzan si el tipo no coincide.
    expect(form.getTextField('nombre')).toBeInstanceOf(PDFTextField);
    expect(form.getCheckBox('acepto')).toBeInstanceOf(PDFCheckBox);
    expect(form.getRadioGroup('envio')).toBeInstanceOf(PDFRadioGroup);
    expect(form.getDropdown('ciudad')).toBeInstanceOf(PDFDropdown);
    expect(form.getOptionList('intereses')).toBeInstanceOf(PDFOptionList);
    expect(form.getRadioGroup('envio').getOptions()).toEqual(['estandar', 'urgente']);
    expect(form.getDropdown('ciudad').getOptions()).toContain('Madrid');
  });

  it('soporta relleno y guardado sin tocar el original', async () => {
    const original = fs.readFileSync(fixture);
    const doc = await PDFDocument.load(new Uint8Array(original));
    const form = doc.getForm();
    form.getTextField('nombre').setText('Vela Pruebas');
    form.getCheckBox('acepto').check();
    form.getRadioGroup('envio').select('urgente');
    form.getDropdown('ciudad').select('Valencia');

    const bytes = await doc.save();
    // El original sigue intacto en disco.
    expect(fs.readFileSync(fixture).equals(original)).toBe(true);

    const round = await PDFDocument.load(new Uint8Array(bytes));
    const form2 = round.getForm();
    expect(form2.getTextField('nombre').getText()).toBe('Vela Pruebas');
    expect(form2.getCheckBox('acepto').isChecked()).toBe(true);
    expect(form2.getRadioGroup('envio').getSelected()).toBe('urgente');
    expect(form2.getDropdown('ciudad').getSelected()).toContain('Valencia');
  });
});

describe('filledCopyName', () => {
  it('propone una copia y nunca el nombre del original', () => {
    expect(filledCopyName('informe.pdf')).toBe('informe-relleno.pdf');
    expect(filledCopyName('INFORME.PDF')).toBe('INFORME-relleno.pdf');
    expect(filledCopyName('sin-extension')).toBe('sin-extension-relleno.pdf');
  });
});
