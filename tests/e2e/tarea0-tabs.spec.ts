/**
 * Tarea 0 (Parte 2): al cambiar de pestaña se conservan página, zoom, scroll
 * y la sección del panel lateral — en PDF y en Markdown, y también tras
 * redimensionar la ventana con la pestaña en segundo plano.
 */
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

const fixtures = path.join(process.cwd(), 'fixtures');

async function openDoc(page: Page, file: string, trigger = '#btn-open'): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.locator(trigger).first().click();
  const fc = await chooser;
  await fc.setFiles(path.join(fixtures, file));
}

async function zoomPct(page: Page): Promise<string> {
  return ((await page.locator('.pdf-toolbar-zoomlabel').textContent()) ?? '').trim();
}

async function pdfScroll(page: Page): Promise<number> {
  return page.evaluate(() => {
    const c = document.querySelector('.pdf-viewer-container') as HTMLElement | null;
    return c ? c.scrollTop : -1;
  });
}

test('Tarea 0: PDF↔Markdown conserva página, zoom y scroll', async ({ page }) => {
  await page.goto('/');
  await openDoc(page, 'ejemplo.pdf');
  await expect(page.locator('.pdfViewer .page canvas').first()).toBeVisible({ timeout: 20_000 });

  // Estado: zoom con dos clics (escala personalizada), página 3 y un scroll
  // fino que se queda dentro de la página (si no, cambiaría la página actual).
  await page.mouse.move(640, 500);
  await page.locator('[aria-label="Acercar"]').click();
  await page.locator('[aria-label="Acercar"]').click();
  await page.mouse.move(640, 500);
  await page.locator('.pdf-toolbar-pageinput').fill('3');
  await page.locator('.pdf-toolbar-pageinput').press('Enter');
  // Espera al cambio REAL de página (la barra de estado lo refleja), no al
  // valor tecleado en el campo.
  await expect.poll(async () => page.locator('#status-right').textContent()).toContain('Página 3');
  // Scroll fino DENTRO de la página 3 (offset de su elemento), hasta que aguanta.
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const c = document.querySelector('.pdf-viewer-container') as HTMLElement;
        const p3 = document.querySelector('.page[data-page-number="3"]') as HTMLElement | null;
        if (!c || !p3) return -1;
        c.scrollTop = p3.offsetTop + 60;
        return c.scrollTop;
      }),
    )
    .toBeGreaterThan(0);
  const pageBefore = await page.locator('.pdf-toolbar-pageinput').inputValue();
  const zoomBefore = await zoomPct(page);
  const scrollBefore = await pdfScroll(page);
  expect(pageBefore).toBe('3');
  expect(scrollBefore).toBeGreaterThan(0);

  // Cambia a Markdown y vuelve.
  await openDoc(page, 'informe.md');
  await expect(page.locator('.md-preview')).toBeVisible();
  await page.locator('.tab').first().click();
  await page.mouse.move(640, 500);

  await expect.poll(async () => page.locator('.pdf-toolbar-pageinput').inputValue()).toBe(pageBefore);
  expect(await zoomPct(page)).toBe(zoomBefore);
  await expect.poll(async () => pdfScroll(page)).toBe(scrollBefore);
});

test('Tarea 0: Markdown↔Markdown conserva modo y scroll de editor y previsualización', async ({ page }) => {
  await page.goto('/');
  await openDoc(page, 'informe.md');
  await expect(page.locator('.md-preview')).toBeVisible();
  await openDoc(page, 'notas.md');
  await expect(page.locator('.tab')).toHaveCount(2);

  // Documento 1: modo Editar y scroll del editor.
  await page.locator('.tab').first().click();
  await page.locator('.md-toolbar .seg-btn', { hasText: 'Editar' }).click();
  await page.evaluate(() => {
    const sc = document.querySelector('.cm-scroller') as HTMLElement;
    sc.scrollTop = 60;
  });
  const modeBefore = await page.locator('.doc-md').getAttribute('data-mode');
  const editorScrollBefore = await page.evaluate(
    () => (document.querySelector('.cm-scroller') as HTMLElement).scrollTop,
  );

  // Cambia al otro Markdown y vuelve.
  await page.locator('.tab').nth(1).click();
  await expect(page.locator('.doc-md')).toHaveCount(1);
  await page.locator('.tab').first().click();

  await expect(page.locator('.doc-md')).toHaveAttribute('data-mode', modeBefore ?? '');
  await expect
    .poll(async () =>
      page.evaluate(() => (document.querySelector('.cm-scroller') as HTMLElement).scrollTop),
    )
    .toBe(editorScrollBefore);
});

test('Tarea 0: se conserva tras redimensionar con la pestaña en segundo plano', async ({ page }) => {
  await page.goto('/');
  await openDoc(page, 'ejemplo.pdf');
  await expect(page.locator('.pdfViewer .page canvas').first()).toBeVisible({ timeout: 20_000 });

  await page.mouse.move(640, 500);
  await page.locator('.pdf-toolbar-pageinput').fill('2');
  await page.locator('.pdf-toolbar-pageinput').press('Enter');
  await page.mouse.move(640, 500);
  await page.locator('[aria-label="Acercar"]').click();
  const zoomBefore = await zoomPct(page);

  await openDoc(page, 'informe.md');
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.locator('.tab').first().click();

  await expect.poll(async () => page.locator('.pdf-toolbar-pageinput').inputValue()).toBe('2');
  // Escala personalizada: no la recalcula el redimensionado.
  expect(await zoomPct(page)).toBe(zoomBefore);
});

test('Tarea 0: el panel lateral recuerda su sección por pestaña', async ({ page }) => {
  await page.goto('/');
  await openDoc(page, 'ejemplo.pdf');
  await expect(page.locator('.pdfViewer .page canvas').first()).toBeVisible({ timeout: 20_000 });

  await page.locator('#btn-sidebar').click();
  await page.locator('#sidebar-tabs .seg-btn', { hasText: 'Índice' }).click();
  await expect(page.locator('#sidebar-tabs .seg-btn.active')).toHaveText('Índice');

  await openDoc(page, 'informe.md');
  await expect(page.locator('.md-preview')).toBeVisible();
  await page.locator('.tab').first().click();
  await expect(page.locator('#sidebar-tabs .seg-btn.active')).toHaveText('Índice');
});
