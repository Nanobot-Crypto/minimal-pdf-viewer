/**
 * E2E de la Parte 2: anotaciones de texto, formas, lápiz, comentarios, firma
 * y modo diagnóstico del zoom.
 */
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { PDFDocument, PDFDict, PDFName } from 'pdf-lib';

const fixtures = path.join(process.cwd(), 'fixtures');

async function openDoc(page: Page, file: string, trigger = '#btn-open'): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.locator(trigger).first().click();
  const fc = await chooser;
  await fc.setFiles(path.join(fixtures, file));
}

/** Abre un PDF y hace visible la barra de anotaciones. */
async function openPdfWithToolbar(page: Page, file = 'ejemplo.pdf'): Promise<void> {
  await page.goto('/');
  await openDoc(page, file);
  await expect(page.locator('.pdfViewer .page canvas').first()).toBeVisible({ timeout: 20_000 });
  await page.mouse.move(640, 500);
  await expect(page.locator('.ann-toolbar')).toBeVisible();
}

/** Simula el diálogo «Guardar como» devolviendo los bytes escritos. */
async function stubSaveTarget(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__velaSaved = null;
    w.__velaSuggested = null;
    w.showSaveFilePicker = async (opts: { suggestedName?: string }) => {
      (window as unknown as Record<string, unknown>).__velaSuggested = opts?.suggestedName ?? null;
      const file = { name: opts?.suggestedName ?? 'copia.pdf', size: 0, lastModified: Date.now() };
      return {
        name: file.name,
        getFile: async () => file,
        createWritable: async () => ({
          write: async (data: unknown) => {
            (window as unknown as Record<string, unknown>).__velaSaved = data;
          },
          close: async () => undefined,
        }),
      };
    };
  });
}

async function savedBytes(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(() => {
    const saved = (window as unknown as Record<string, unknown>).__velaSaved as Uint8Array | null;
    if (!saved) return null;
    const bytes = saved instanceof Uint8Array ? saved : new Uint8Array(saved as ArrayBuffer);
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  });
  expect(b64).toBeTruthy();
  return Buffer.from(b64 as string, 'base64');
}

/** Arrastra sobre el primer span de texto para seleccionarlo. */
async function selectFirstText(page: Page): Promise<void> {
  const span = page.locator('.textLayer span').first();
  const box = (await span.boundingBox())!;
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
}

test('resaltar: crear, deshacer/rehacer y guardar copia con /Highlight', async ({ page }) => {
  await openPdfWithToolbar(page);
  await page.locator('.ann-toolbar [aria-label="Resaltar"]').click();
  await selectFirstText(page);
  await expect(page.locator('.ann-mark.ann-highlight').first()).toBeVisible();

  // Deshacer/rehacer.
  await page.mouse.move(640, 500);
  await page.locator('[aria-label="Deshacer anotación"]').click();
  await expect(page.locator('.ann-mark.ann-highlight')).toHaveCount(0);
  await page.locator('[aria-label="Rehacer anotación"]').click();
  await expect(page.locator('.ann-mark.ann-highlight').first()).toBeVisible();

  // Guardar copia: el PDF contiene la anotación estándar.
  await stubSaveTarget(page);
  await page.locator('[aria-label="Guardar copia con anotaciones"]').click();
  await expect
    .poll(async () => page.evaluate(() => (window as unknown as Record<string, unknown>).__velaSuggested))
    .toBe('ejemplo-anotado.pdf');
  const bytes = await savedBytes(page);
  const copy = await PDFDocument.load(bytes);
  const annots = copy.getPage(0).node.Annots();
  const subtypes = Array.from({ length: annots?.size() ?? 0 }, (_, i) =>
    String((annots!.lookup(i, PDFDict) as PDFDict).get(PDFName.of('Subtype'))),
  );
  expect(subtypes).toContain('/Highlight');
});

test('formas y lápiz: dibujar por arrastre y borrar', async ({ page }) => {
  await openPdfWithToolbar(page);
  const pageBox = (await page.locator('.pdfViewer .page').first().boundingBox())!;

  // Rectángulo.
  await page.locator('.ann-toolbar [aria-label="Rectángulo"]').click();
  await page.mouse.move(pageBox.x + 80, pageBox.y + 120);
  await page.mouse.down();
  await page.mouse.move(pageBox.x + 200, pageBox.y + 200, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('.ann-mark.ann-shape').first()).toBeVisible();

  // Lápiz (a mano alzada).
  await page.mouse.move(640, 500);
  await page.locator('.ann-toolbar [aria-label="Lápiz (a mano alzada)"]').click();
  await page.mouse.move(pageBox.x + 60, pageBox.y + 300);
  await page.mouse.down();
  await page.mouse.move(pageBox.x + 120, pageBox.y + 330, { steps: 8 });
  await page.mouse.move(pageBox.x + 180, pageBox.y + 300, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.ann-mark.ann-ink').first()).toBeVisible();

  // Seleccionar con la herramienta «Seleccionar» y borrar.
  await page.mouse.move(640, 500);
  await page.locator('.ann-toolbar [aria-label="Seleccionar / mover"]').click();
  await page.locator('.ann-mark.ann-ink').first().click();
  await page.locator('[aria-label="Borrar anotación"]').click();
  await expect(page.locator('.ann-mark.ann-ink')).toHaveCount(0);
});

test('comentario: crear, editar, lista lateral y borrado', async ({ page }) => {
  await openPdfWithToolbar(page);
  await page.locator('.ann-toolbar [aria-label="Comentario"]').click();
  await page.locator('.dialog textarea').fill('Nota de prueba');
  await page.locator('.dialog .btn-primary').click();
  await expect(page.locator('.ann-mark.ann-comment').first()).toBeVisible();

  // Lista en el panel lateral.
  await page.locator('#btn-sidebar').click();
  await page.locator('#sidebar-tabs .seg-btn', { hasText: 'Comentarios' }).click();
  await expect(page.locator('.comment-row .comment-text')).toContainText('Nota de prueba');

  // Doble clic → editar.
  await page.mouse.move(640, 500);
  await page.locator('.ann-mark.ann-comment').first().dblclick();
  await page.locator('.dialog textarea').fill('Texto editado');
  await page.locator('.dialog .btn-primary').click();
  await expect(page.locator('.comment-row .comment-text')).toContainText('Texto editado');

  // Borrar.
  await page.mouse.move(640, 500);
  await page.locator('.ann-mark.ann-comment').first().click();
  await page.locator('[aria-label="Borrar anotación"]').click();
  await expect(page.locator('.ann-mark.ann-comment')).toHaveCount(0);
});

test('firma: dibujar, colocar, redimensionar y guardar como /Stamp', async ({ page }) => {
  await openPdfWithToolbar(page);
  await stubSaveTarget(page);

  await page.locator('.ann-toolbar [aria-label="Firma"]').click();
  await page.locator('.signature-panel .btn', { hasText: 'Dibujar firma nueva' }).click();
  const canvas = page.locator('.signature-canvas');
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 60, box.y + 120);
  await page.mouse.down();
  await page.mouse.move(box.x + 220, box.y + 80, { steps: 10 });
  await page.mouse.move(box.x + 380, box.y + 130, { steps: 10 });
  await page.mouse.up();
  await page.locator('.signature-panel .btn-primary', { hasText: 'Guardar firma' }).click();

  // Se reabre el selector con la firma nueva: «Usar» la coloca.
  await page.locator('.signature-row .btn', { hasText: 'Usar' }).click();
  await expect(page.locator('.ann-mark.ann-image').first()).toBeVisible();

  // Aviso de firma visual en la interfaz.
  await expect(page.locator('#status-right')).toContainText('sin validez legal');

  // Guardar copia: el PDF contiene el sello estándar.
  await page.locator('[aria-label="Guardar copia con anotaciones"]').click();
  await expect
    .poll(async () => page.evaluate(() => (window as unknown as Record<string, unknown>).__velaSaved))
    .toBeTruthy();
  const bytes = await savedBytes(page);
  const copy = await PDFDocument.load(bytes);
  const annots = copy.getPage(0).node.Annots();
  const subtypes = Array.from({ length: annots?.size() ?? 0 }, (_, i) =>
    String((annots!.lookup(i, PDFDict) as PDFDict).get(PDFName.of('Subtype'))),
  );
  expect(subtypes).toContain('/Stamp');
});

test('modo diagnóstico: el panel de eventos de zoom se muestra al activarlo', async ({ page }) => {
  await openPdfWithToolbar(page);

  // Apagado por defecto.
  await page.mouse.move(640, 500);
  await page.evaluate(() =>
    document
      .querySelector('.pdf-viewer-container')!
      .dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -100, cancelable: true, bubbles: true })),
  );
  await expect(page.locator('#zoom-log')).toHaveCount(0);

  // Activar en Ajustes.
  await page.locator('#btn-settings').click();
  await page.locator('.settings-check-zoomdiag[aria-label="Registrar eventos de zoom"]').check();
  await page.keyboard.press('Escape');
  await expect(page.locator('#zoom-log')).toBeVisible();

  // Un Ctrl+rueda queda registrado.
  await page.mouse.move(640, 500);
  await page.evaluate(() =>
    document
      .querySelector('.pdf-viewer-container')!
      .dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -100, cancelable: true, bubbles: true })),
  );
  await expect(page.locator('#zoom-log .zoom-log-row').first()).toContainText('wheel');
  await expect(page.locator('#zoom-log .zoom-log-row').first()).toContainText('ctrl=sí');
});
