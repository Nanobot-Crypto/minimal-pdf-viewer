/**
 * Pruebas E2E de las correcciones y mejoras:
 *  - paleta de comandos: las opciones responden al clic (fallo 2);
 *  - miniaturas: primera página pintada y proporción correcta en HiDPI (fallos 1 y 3);
 *  - esquema Markdown: el clic no cambia de modo de vista (fallo 4);
 *  - notas en PDF y Markdown con persistencia (mejora 5);
 *  - formularios AcroForm: relleno y guardado de copia (mejora 6);
 *  - barra de título integrada: sin controles nativos en navegador (interfaz 9).
 */
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';

const fixtures = path.join(process.cwd(), 'fixtures');

async function openDoc(page: Page, file: string, trigger?: string): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.locator(trigger ?? '.empty-actions button').first().click();
  const fc = await chooser;
  await fc.setFiles(path.join(fixtures, file));
}

/**
 * Deja el panel lateral ABIERTO con independencia del estado persistido
 * (el arranque es con el panel cerrado, pero el estado se persiste y tras
 * recargar puede llegar abierto: las pruebas no deben asumir ninguno).
 */
async function ensureSidebarOpen(page: Page): Promise<void> {
  const closed = await page.locator('#sidebar').evaluate((el) => el.classList.contains('closed'));
  if (closed) await page.locator('#btn-sidebar').click();
  await expect(page.locator('#sidebar')).not.toHaveClass(/closed/);
}

/* ------------------------------------------------------------------ */
/* Fallo 2: paleta de comandos                                         */
/* ------------------------------------------------------------------ */

test('paleta: las opciones ejecutan su función al hacer clic', async ({ page }) => {
  await page.goto('/');
  await openDoc(page, 'informe.md');
  await expect(page.locator('.md-preview h1')).toBeVisible();

  // Abrir con el «+» de la derecha y pasar el ratón por encima antes de clicar
  // (el bug original rehacía el DOM al pasar el ratón y el clic se perdía).
  await page.locator('#btn-palette').click();
  const item = page.locator('.palette-item', { hasText: 'Tema oscuro' });
  await item.hover();
  await item.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  // Una segunda opción también funciona con clic. Se parte de un estado
  // conocido (panel abierto) para que el conmutador lo cierre.
  await ensureSidebarOpen(page);
  await page.locator('#btn-palette').click();
  const sidebarItem = page.locator('.palette-item', { hasText: 'Mostrar/ocultar panel lateral' });
  await sidebarItem.hover();
  await sidebarItem.click();
  await expect(page.locator('#sidebar')).toHaveClass(/closed/);

  // Y el teclado sigue funcionando.
  await page.keyboard.press('Control+k');
  await expect(page.locator('.palette-input')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.palette-input')).toBeHidden();
});

/* ------------------------------------------------------------------ */
/* Fallos 1 y 3: miniaturas                                            */
/* ------------------------------------------------------------------ */

interface ThumbInfo {
  w: number;
  h: number;
  cssW: number;
  cssH: number;
  painted: boolean;
}

async function thumbInfo(page: Page): Promise<ThumbInfo[]> {
  return page.evaluate(() => {
    const out: { w: number; h: number; cssW: number; cssH: number; painted: boolean }[] = [];
    for (const c of document.querySelectorAll('canvas.thumb-canvas')) {
      const canvas = c as HTMLCanvasElement;
      const painted = (() => {
        if (!canvas.width || !canvas.height) return false;
        const ctx = canvas.getContext('2d');
        if (!ctx) return false;
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        for (let i = 0; i < data.length; i += 41 * 4) {
          if (data[i] < 235 || data[i + 1] < 235 || data[i + 2] < 235) return true;
        }
        return false;
      })();
      out.push({
        w: canvas.width,
        h: canvas.height,
        cssW: parseFloat(canvas.style.width),
        cssH: parseFloat(canvas.style.height),
        painted,
      });
    }
    return out;
  });
}

test('miniaturas: la primera página se pinta completa (no queda en blanco)', async ({ page }) => {
  await page.goto('/');
  await openDoc(page, 'ejemplo.pdf');
  await expect(page.locator('.pdfViewer .page canvas').first()).toBeVisible({ timeout: 20_000 });
  await page.locator('#btn-sidebar').click();
  await expect(page.locator('.thumb-cell')).toHaveCount(5);
  await page.waitForTimeout(800);

  const thumbs = await thumbInfo(page);
  expect(thumbs).toHaveLength(5);
  // Página 1: pintada y con proporción A4 (595×842).
  expect(thumbs[0].painted).toBe(true);
  expect(thumbs[0].cssW).toBeCloseTo(116, 0);
  expect(thumbs[0].cssH / thumbs[0].cssW).toBeCloseTo(842 / 595, 1);
  // No se queda con el tamaño por defecto del canvas (300×150, apaisado y en blanco).
  expect(thumbs[0].w).not.toBe(300);
  expect(thumbs[0].h).not.toBe(150);
});

test.describe('miniaturas en pantalla HiDPI', () => {
  test.use({ deviceScaleFactor: 2 });

  test('cada página ocupa toda la miniatura con su proporción', async ({ page }) => {
    await page.goto('/');
    await openDoc(page, 'ejemplo.pdf');
    await expect(page.locator('.pdfViewer .page canvas').first()).toBeVisible({ timeout: 20_000 });
    await page.locator('#btn-sidebar').click();
    await expect(page.locator('.thumb-cell')).toHaveCount(5);

    // Fuerza la carga de las miniaturas inferiores desplazando el panel.
    await page.locator('.thumb-cell').last().click();
    await page.waitForTimeout(900);

    const thumbs = await thumbInfo(page);
    expect(thumbs).toHaveLength(5);
    for (const t of thumbs) {
      // La página ocupa la miniatura entera: el canvas interno se ajusta al CSS.
      expect(t.cssW).toBeCloseTo(116, 0);
      expect(t.cssH / t.cssW).toBeCloseTo(842 / 595, 1);
      // Con densidad 2 el backing store es el doble y el dibujo lo llena todo
      // (antes el contenido quedaba diminuto en la esquina superior izquierda).
      expect(t.w / t.cssW).toBeCloseTo(2, 1);
      expect(t.h / t.cssH).toBeCloseTo(2, 1);
      expect(t.painted).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Fallo 4: esquema Markdown                                           */
/* ------------------------------------------------------------------ */

test('esquema Markdown: el clic desplaza sin cambiar el modo de vista', async ({ page }) => {
  await page.goto('/');
  await openDoc(page, 'informe.md');
  await expect(page.locator('.md-preview h1')).toHaveText('Informe de pruebas');

  // Modo solo lectura: el clic no debe abrir la vista dividida.
  await page.getByRole('button', { name: 'Leer', exact: true }).click();
  await expect(page.locator('.md-editor-host')).toBeHidden();
  await ensureSidebarOpen(page);
  await page.locator('#sidebar-tabs .seg-btn', { hasText: 'Esquema' }).click();
  await expect(page.locator('.outline-row').first()).toBeVisible();
  await page.locator('.outline-row', { hasText: 'Imagen relativa' }).click();
  await expect(page.locator('.doc-md')).toHaveAttribute('data-mode', 'preview');
  await expect(page.locator('.md-editor-host')).toBeHidden();

  const scroll = await page.evaluate(() => {
    const preview = document.querySelector('.md-preview') as HTMLElement;
    const target = Array.from(preview.querySelectorAll('h1,h2,h3,h4,h5,h6')).find(
      (h) => h.textContent?.trim() === 'Imagen relativa',
    ) as HTMLElement | undefined;
    const top = target
      ? target.getBoundingClientRect().top - preview.getBoundingClientRect().top
      : Number.NaN;
    return { top, fits: preview.scrollHeight <= preview.clientHeight + 2 };
  });
  // O el documento cabe entero (no hay nada que desplazar) o el encabezado
  // queda alineado al inicio de la vista.
  expect(scroll.fits || (scroll.top > -30 && scroll.top < 80)).toBe(true);

  // En modo dividido tampoco cambia de vista.
  await page.getByRole('button', { name: 'Dividir', exact: true }).click();
  await page.locator('.outline-row', { hasText: 'Cita' }).click();
  await expect(page.locator('.doc-md')).toHaveAttribute('data-mode', 'split');
  await expect(page.locator('.md-editor-host')).toBeVisible();
});

/* ------------------------------------------------------------------ */
/* Mejora 5: notas                                                     */
/* ------------------------------------------------------------------ */

test('notas PDF: añadir, ir a la página, persistir y borrar', async ({ page }) => {
  await page.goto('/');
  await openDoc(page, 'ejemplo.pdf');
  await expect(page.locator('.pdfViewer .page canvas').first()).toBeVisible({ timeout: 20_000 });

  // Ir a la página 3 y añadir la nota allí.
  await page.mouse.move(640, 500);
  await page.locator('.pdf-toolbar-pageinput').fill('3');
  await page.locator('.pdf-toolbar-pageinput').press('Enter');
  await expect(page.locator('#status-right')).toContainText('Página 3 / 5');

  await ensureSidebarOpen(page);
  await page.locator('#sidebar-tabs .seg-btn', { hasText: 'Notas' }).click();
  await page.getByRole('button', { name: /^Añadir nota/ }).click();
  await page.locator('.dialog-textarea').fill('Revisar la tabla de la página 3');
  await page.getByRole('button', { name: 'Guardar nota' }).click();
  await expect(page.locator('.note-row')).toHaveCount(1);
  await expect(page.locator('.note-text')).toContainText('Revisar la tabla');

  // Clic en la nota → va a su página.
  await page.mouse.move(640, 500);
  await page.locator('.pdf-toolbar-pageinput').fill('1');
  await page.locator('.pdf-toolbar-pageinput').press('Enter');
  await expect(page.locator('#status-right')).toContainText('Página 1 / 5');
  await page.locator('.note-row').first().click();
  await expect(page.locator('#status-right')).toContainText('Página 3 / 5');

  // Persistencia: al recargar y reabrir el documento, la nota sigue ahí.
  await page.waitForTimeout(700);
  await page.reload();
  await openDoc(page, 'ejemplo.pdf');
  await expect(page.locator('.pdfViewer .page canvas').first()).toBeVisible({ timeout: 20_000 });
  await ensureSidebarOpen(page);
  await page.locator('#sidebar-tabs .seg-btn', { hasText: 'Notas' }).click();
  await expect(page.locator('.note-text')).toContainText('Revisar la tabla');

  // Borrar.
  await page.locator('.note-row').first().hover();
  await page.getByRole('button', { name: 'Borrar nota' }).click();
  await expect(page.locator('.note-row')).toHaveCount(0);
});

test('notas Markdown: añadir, persistir y no tocar el documento', async ({ page }) => {
  await page.goto('/');
  await openDoc(page, 'notas.md');
  await expect(page.locator('.md-preview h1')).toBeVisible();

  await ensureSidebarOpen(page);
  await page.locator('#sidebar-tabs .seg-btn', { hasText: 'Notas' }).click();
  await page.getByRole('button', { name: 'Añadir nota' }).click();
  await page.locator('.dialog-textarea').fill('Pendiente: revisar el esquema');
  await page.getByRole('button', { name: 'Guardar nota' }).click();
  await expect(page.locator('.note-text')).toContainText('Pendiente: revisar el esquema');

  // El documento sigue en modo edición, sin cambios.
  await expect(page.locator('.tab').first()).not.toHaveClass(/dirty/);

  await page.waitForTimeout(700);
  await page.reload();
  await openDoc(page, 'notas.md');
  await ensureSidebarOpen(page);
  await page.locator('#sidebar-tabs .seg-btn', { hasText: 'Notas' }).click();
  await expect(page.locator('.note-text')).toContainText('Pendiente: revisar el esquema');
});

/* ------------------------------------------------------------------ */
/* Mejora 6: formularios AcroForm                                      */
/* ------------------------------------------------------------------ */

test('formulario PDF: rellenar y guardar una copia sin tocar el original', async ({ page }) => {
  const original = fs.readFileSync(path.join(fixtures, 'formulario.pdf'));
  await page.goto('/');
  await openDoc(page, 'formulario.pdf');
  await expect(page.locator('.annotationLayer input[type="text"]').first()).toBeVisible({
    timeout: 20_000,
  });

  // Relleno directamente sobre los widgets del visor.
  await page.locator('.annotationLayer input[type="text"]').first().fill('Vela Pruebas');
  await page.locator('.annotationLayer input[type="text"]').nth(1).fill('hola@example.com');
  await page.locator('.annotationLayer input[type="checkbox"]').first().check();
  await page.locator('.annotationLayer input[type="radio"]').nth(1).check();
  await page.locator('.annotationLayer select').first().selectOption('Valencia');

  // El botón de guardar copia aparece porque el PDF tiene campos.
  const saveBtn = page.locator('[aria-label="Guardar copia del formulario"]');
  await page.mouse.move(640, 500);
  await expect(saveBtn).toBeVisible();

  // Guardado con destino simulado (sin sobrescribir nada real).
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
  await saveBtn.click();

  // La copia propuesta nunca es el nombre del original.
  await expect.poll(async () => page.evaluate(() => (window as unknown as Record<string, unknown>).__velaSuggested)).toBe('formulario-relleno.pdf');

  const b64 = await page.evaluate(() => {
    const saved = (window as unknown as Record<string, unknown>).__velaSaved as Uint8Array | null;
    if (!saved) return null;
    const bytes = saved instanceof Uint8Array ? saved : new Uint8Array(saved as ArrayBuffer);
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  });
  expect(b64).toBeTruthy();
  const bytes = Buffer.from(b64 as string, 'base64');
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');

  // La copia contiene los valores rellenos…
  const copy = await PDFDocument.load(bytes);
  const form = copy.getForm();
  expect(form.getTextField('nombre').getText()).toBe('Vela Pruebas');
  expect(form.getTextField('email').getText()).toBe('hola@example.com');
  expect(form.getCheckBox('acepto').isChecked()).toBe(true);
  expect(form.getRadioGroup('envio').getSelected()).toBe('urgente');
  expect(form.getDropdown('ciudad').getSelected()).toContain('Valencia');

  // …y el original sigue intacto en disco.
  expect(fs.readFileSync(path.join(fixtures, 'formulario.pdf')).equals(original)).toBe(true);
});

/* ------------------------------------------------------------------ */
/* Interfaz 9: barra de título integrada                               */
/* ------------------------------------------------------------------ */

test('interfaz: sin controles de ventana nativos en modo navegador', async ({ page }) => {
  await page.goto('/');
  // En navegador la ventana la gestiona el navegador: los controles propios
  // y los bordes de redimensionado permanecen ocultos.
  await expect(page.locator('#window-controls')).toBeHidden();
  await expect(page.locator('.resize-handle').first()).toBeHidden();
  // La cabecera sigue integrada con las pestañas en la misma fila.
  await expect(page.locator('#topbar #tabstrip')).toBeVisible();
  await expect(page.locator('#topbar')).toHaveAttribute('data-tauri-drag-region', '');
});
