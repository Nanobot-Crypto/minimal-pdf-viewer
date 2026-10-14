/**
 * Pruebas E2E de Vela en modo navegador (el bridge usa File System Access API).
 * Las mismas rutas de código se ejecutan en escritorio vía Tauri.
 */
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const fixtures = path.join(process.cwd(), 'fixtures');
const shots = path.join(process.cwd(), 'docs', 'screenshots');
fs.mkdirSync(shots, { recursive: true });

async function openDoc(page: Page, file: string): Promise<void> {
  await openDocVia(page, file, page.locator('.empty-actions button, #btn-open').first());
}

async function openDocVia(
  page: Page,
  file: string,
  trigger: ReturnType<Page['locator']>,
): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await trigger.click();
  const fc = await chooser;
  await fc.setFiles(path.join(fixtures, file));
}

test('estado vacío, recientes y tema claro', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.empty-card h1')).toHaveText('Vela');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.screenshot({ path: path.join(shots, '1-vacio-claro.png') });

  // Abrir un documento crea un reciente que sobrevive a la recarga.
  await openDoc(page, 'ejemplo.pdf');
  await expect(page.locator('.pdfViewer .page').first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(700); // debounce de persistencia
  await page.reload();
  await expect(page.locator('.empty-card h1')).toHaveText('Vela');
  await expect(page.locator('.recent-item').first()).toContainText('ejemplo.pdf');
});

test('PDF: navegación, zoom, búsqueda e interfaz flotante', async ({ page }) => {
  await page.goto('/');
  await openDoc(page, 'ejemplo.pdf');

  // Render y estado
  await expect(page.locator('.pdfViewer .page canvas').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#status-right')).toContainText('Página 1 / 5');

  // La barra de controles aparece al mover el ratón
  await page.mouse.move(640, 500);
  await expect(page.locator('.pdf-toolbar')).toBeVisible();
  await page.screenshot({ path: path.join(shots, '2-pdf-claro.png') });

  // Ir a la página 3 con el campo de página
  await page.locator('.pdf-toolbar-pageinput').fill('3');
  await page.locator('.pdf-toolbar-pageinput').press('Enter');
  await expect(page.locator('#status-right')).toContainText('Página 3 / 5');

  // Zoom con teclado
  const zoomBefore = await page.locator('.pdf-toolbar-zoomlabel').textContent();
  await page.keyboard.press('Control+Equal');
  await expect
    .poll(async () => page.locator('.pdf-toolbar-zoomlabel').textContent())
    .not.toBe(zoomBefore);

  // Búsqueda de texto
  await page.keyboard.press('Control+f');
  await expect(page.locator('.findbar')).toBeVisible();
  await page.locator('.findbar-input').fill('mariposa');
  await expect(page.locator('.findbar-count')).toContainText('/');
  await expect(page.locator('.findbar-count')).not.toContainText('sin resultados');
  const found = Number(((await page.locator('.findbar-count').textContent()) ?? '0/0').split('/')[1]);
  expect(found).toBeGreaterThanOrEqual(3);
  await page.screenshot({ path: path.join(shots, '3-pdf-busqueda.png') });

  // Panel lateral: miniaturas
  await page.locator('#btn-sidebar').click();
  await expect(page.locator('.thumb-cell')).toHaveCount(5);
  await expect(page.locator('.thumb-cell.active')).toHaveAttribute('data-page', '3');
});

test('Markdown: edición, previsualización en vivo y modos', async ({ page }) => {
  await page.goto('/');
  await openDoc(page, 'informe.md');

  await expect(page.locator('.md-preview h1')).toHaveText('Informe de pruebas');
  await expect(page.locator('.md-preview table')).toBeVisible();
  await expect(page.locator('.md-preview pre code').first()).toBeVisible();

  // Edición con actualización automática de la previsualización
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n\n## Añadido en la prueba');
  await expect(page.locator('.md-preview h2').last()).toHaveText('Añadido en la prueba', {
    timeout: 5_000,
  });

  // Pestaña marcada con cambios sin guardar
  await expect(page.locator('.tab').first()).toHaveClass(/dirty/);

  // Modos de vista
  await page.getByRole('button', { name: 'Leer', exact: true }).click();
  await expect(page.locator('.md-editor-host')).toBeHidden();
  await page.getByRole('button', { name: 'Dividir', exact: true }).click();
  await expect(page.locator('.md-editor-host')).toBeVisible();
  await page.screenshot({ path: path.join(shots, '4-md-dividido.png') });
});

test('paleta de comandos y tema oscuro', async ({ page }) => {
  await page.goto('/');
  await openDoc(page, 'informe.md');
  await expect(page.locator('.md-preview h1')).toBeVisible();

  await page.keyboard.press('Control+k');
  await expect(page.locator('.palette-input')).toBeVisible();
  await page.screenshot({ path: path.join(shots, '5-paleta.png') });
  await page.locator('.palette-input').fill('oscuro');
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.md-preview h1')).toBeVisible();
  await page.screenshot({ path: path.join(shots, '6-md-oscuro.png') });

  // PDF en modo oscuro
  await openDocVia(page, 'ejemplo.pdf', page.locator('#btn-open'));
  await expect(page.locator('.pdfViewer .page canvas').first()).toBeVisible({ timeout: 20_000 });
  await page.mouse.move(640, 500);
  await page.screenshot({ path: path.join(shots, '7-pdf-oscuro.png') });
});

test('PDF extenso: carga rápida y salto a página lejana', async ({ page }) => {
  await page.goto('/');
  const start = Date.now();
  await openDoc(page, 'grande.pdf');
  await expect(page.locator('.pdfViewer .page').first()).toBeVisible({ timeout: 30_000 });
  const openMs = Date.now() - start;
  expect(openMs).toBeLessThan(15_000);
  await expect(page.locator('#status-right')).toContainText('/ 120');

  // Búsqueda en documento extenso (solo página 100 contiene esa cadena)
  await page.keyboard.press('Control+f');
  await page.locator('.findbar-input').fill('Documento extenso — página 100');
  await expect(page.locator('.findbar-count')).toContainText('/');
  const total = Number(((await page.locator('.findbar-count').textContent()) ?? '0/0').split('/')[1]);
  expect(total).toBeGreaterThanOrEqual(1);
  await page.keyboard.press('Escape');

  // Salto directo con el campo de página
  await page.mouse.move(640, 500);
  await page.locator('.pdf-toolbar-pageinput').fill('100');
  await page.locator('.pdf-toolbar-pageinput').press('Enter');
  await expect(page.locator('#status-right')).toContainText('Página 100 / 120');
});

test('pestañas: cerrar con confirmación y menú contextual', async ({ page }) => {
  await page.goto('/');
  await openDoc(page, 'notas.md');
  await expect(page.locator('.tab')).toHaveCount(1);

  await openDocVia(page, 'informe.md', page.locator('#btn-open'));
  await expect(page.locator('.tab')).toHaveCount(2);
  // Editar el primer documento y cerrarlo pide confirmación
  await page.locator('.tab').first().click();
  await page.locator('.cm-content').click();
  await page.keyboard.type('cambio ');
  await expect(page.locator('.tab').first()).toHaveClass(/dirty/);
  await page.locator('.tab').first().hover();
  await page.locator('.tab').first().locator('.tab-close').click();
  await expect(page.locator('.dialog-title')).toHaveText('Cambios sin guardar');
  await page.getByRole('button', { name: 'Cerrar sin guardar' }).click();
  await expect(page.locator('.tab')).toHaveCount(1);
  await expect(page.locator('.tab-name')).toHaveText('informe.md');

  // Menú contextual de pestaña
  await page.locator('.tab').first().click({ button: 'right' });
  await expect(page.locator('.context-menu')).toBeVisible();
  await expect(page.locator('.context-item', { hasText: 'Cerrar' }).first()).toBeVisible();
});
