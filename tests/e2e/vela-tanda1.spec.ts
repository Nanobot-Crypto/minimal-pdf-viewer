/**
 * Pruebas E2E de la tanda 1:
 *  1. Recordar la posición del PDF (página, zoom y ajuste) al reabrir.
 *  2. Autoguardado y recuperación de borradores Markdown.
 *  3. Panel de Ajustes: tema, acento, tipografía y atajos configurables.
 */
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

const fixtures = path.join(process.cwd(), 'fixtures');
const shots = path.join(process.cwd(), 'docs', 'screenshots');

async function openDoc(page: Page, file: string, trigger = '.empty-actions button, #btn-open'): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.locator(trigger).first().click();
  const fc = await chooser;
  await fc.setFiles(path.join(fixtures, file));
}

async function closeCurrentTab(page: Page): Promise<void> {
  await page.locator('.tab').first().hover();
  await page.locator('.tab-close').first().click();
}

/* ------------------------------------------------------------------ */
/* 1. Posición de lectura del PDF                                      */
/* ------------------------------------------------------------------ */

test('PDF: recuerda página, zoom y ajuste al reabrir el documento', async ({ page }) => {
  await page.goto('/');
  await openDoc(page, 'ejemplo.pdf');
  await expect(page.locator('.pdfViewer .page canvas').first()).toBeVisible({ timeout: 20_000 });

  // Página 3 con ajuste a la página.
  await page.mouse.move(640, 500);
  await page.locator('.pdf-toolbar-pageinput').fill('3');
  await page.locator('.pdf-toolbar-pageinput').press('Enter');
  await expect(page.locator('#status-right')).toContainText('Página 3 / 5');
  await page.locator('.pdf-toolbar button[aria-label="Ajustar a la página"]').click();
  await expect(page.locator('.pdf-toolbar-zoomlabel')).not.toHaveText('—');
  const fitZoom = (await page.locator('.pdf-toolbar-zoomlabel').textContent()) ?? '';
  expect(fitZoom).not.toBe('');

  // La posición se guarda sola (debounce) y sobrevive a recargar la app.
  await page.waitForTimeout(900);
  await page.reload();
  await openDoc(page, 'ejemplo.pdf');
  await expect(page.locator('.pdfViewer .page canvas').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#status-right')).toContainText('Página 3 / 5');
  await expect(page.locator('.pdf-toolbar-zoomlabel')).toHaveText(fitZoom);

  // Escala fija (zoom manual): también se recuerda al cerrar y reabrir.
  await page.mouse.move(640, 500);
  await page.locator('.pdf-toolbar button[aria-label="Acercar"]').click();
  await page.locator('.pdf-toolbar button[aria-label="Acercar"]').click();
  const manualZoom = (await page.locator('.pdf-toolbar-zoomlabel').textContent()) ?? '';
  expect(manualZoom).not.toBe(fitZoom);
  await page.waitForTimeout(900);
  await closeCurrentTab(page);
  await expect(page.locator('.empty-card h1')).toBeVisible();
  await openDoc(page, 'ejemplo.pdf');
  await expect(page.locator('.pdfViewer .page canvas').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#status-right')).toContainText('Página 3 / 5');
  await expect(page.locator('.pdf-toolbar-zoomlabel')).toHaveText(manualZoom);
});

/* ------------------------------------------------------------------ */
/* 2. Borradores de recuperación Markdown                              */
/* ------------------------------------------------------------------ */

test('Markdown: guarda borradores y ofrece restaurarlos al reabrir', async ({ page }) => {
  await page.goto('/');
  await openDoc(page, 'notas.md');
  await expect(page.locator('.md-preview h1')).toBeVisible();

  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n\nBorrador de prueba tanda 1');
  await expect(page.locator('.tab').first()).toHaveClass(/dirty/);
  // Autoguardado del borrador (no toca el archivo original).
  await page.waitForTimeout(1700);

  // Cerrar sin guardar conserva el borrador como red de seguridad.
  await closeCurrentTab(page);
  await expect(page.locator('.dialog-title')).toHaveText('Cambios sin guardar');
  await page.getByRole('button', { name: 'Cerrar sin guardar' }).click();
  await expect(page.locator('.empty-card h1')).toBeVisible();

  // Al reabrir se ofrece «Restaurar borrador / Descartar».
  await openDoc(page, 'notas.md');
  await expect(page.locator('.dialog-title')).toHaveText('Borrador de recuperación');
  await page.getByRole('button', { name: 'Descartar' }).click();
  await expect(page.locator('.md-preview')).not.toContainText('Borrador de prueba tanda 1');
  await expect(page.locator('.tab').first()).not.toHaveClass(/dirty/);

  // Segunda vuelta: ahora se restaura el borrador.
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n\nSegundo borrador');
  await page.waitForTimeout(1700);
  await closeCurrentTab(page);
  await page.getByRole('button', { name: 'Cerrar sin guardar' }).click();
  await openDoc(page, 'notas.md');
  await expect(page.locator('.dialog-title')).toHaveText('Borrador de recuperación');
  await page.getByRole('button', { name: 'Restaurar borrador' }).click();
  await expect(page.locator('.md-preview')).toContainText('Segundo borrador');
  await expect(page.locator('.tab').first()).toHaveClass(/dirty/);
});

test('Markdown: el autoguardado en el archivo pide confirmación explícita', async ({ page }) => {
  await page.goto('/');
  // Destino de guardado simulado: no se toca ningún archivo real.
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__velaSavedText = null;
    w.showSaveFilePicker = async () => ({
      name: 'notas.md',
      getFile: async () => ({ name: 'notas.md', size: 1, lastModified: Date.now() }),
      createWritable: async () => ({
        write: async (data: unknown) => {
          w.__velaSavedText = String(data);
        },
        close: async () => undefined,
      }),
    });
  });

  await openDoc(page, 'notas.md');
  await expect(page.locator('.md-preview h1')).toBeVisible();
  await page.keyboard.press('Control+Comma');
  await expect(page.locator('.settings-panel')).toBeVisible();

  const check = page.locator('.settings-check');
  await check.check();
  await expect(page.locator('.dialog-title')).toContainText('Activar el autoguardado');
  // Cancelar deja el ajuste desactivado: nada se escribe sin confirmación.
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await expect(check).not.toBeChecked();

  await check.check();
  await page.getByRole('button', { name: 'Activar', exact: true }).click();
  await expect(check).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(page.locator('.settings-panel')).toBeHidden();

  await page.locator('.cm-content').click();
  await page.keyboard.type('texto autoguardado');
  await expect
    .poll(async () => page.evaluate(() => (window as unknown as Record<string, unknown>).__velaSavedText as string | null), {
      timeout: 15_000,
    })
    .toContain('texto autoguardado');
  await expect(page.locator('.tab').first()).not.toHaveClass(/dirty/);
});

/* ------------------------------------------------------------------ */
/* 3. Panel de Ajustes                                                 */
/* ------------------------------------------------------------------ */

test('Ajustes: tema, acento, tipografía y atajos configurables', async ({ page }) => {
  await page.goto('/');
  await openDoc(page, 'informe.md');
  await expect(page.locator('.md-preview h1')).toBeVisible();

  // Ctrl+, abre el panel; también está en la paleta de comandos.
  await page.keyboard.press('Control+Comma');
  await expect(page.locator('.settings-panel')).toBeVisible();
  await expect(page.locator('.settings-section-title', { hasText: 'Apariencia' })).toBeVisible();
  await expect(page.locator('.settings-section-title', { hasText: 'Atajos de teclado' })).toBeVisible();
  await page.screenshot({ path: path.join(shots, '8-ajustes.png') });

  // Acento de color.
  await page.locator('.accent-swatch[aria-label="Acento Ciruela"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'plum');

  // Tipografía de la previsualización (tamaño).
  await page.locator('.settings-range').nth(1).evaluate((el) => {
    const input = el as HTMLInputElement;
    input.value = '20';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('.md-preview')).toHaveCSS('font-size', '20px');

  // Tema oscuro desde el panel.
  await page.locator('.settings-panel .seg-btn', { hasText: 'Oscuro' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  // Lista de atajos con el valor por defecto visible.
  const paletteCombo = page
    .locator('.shortcut-row', { hasText: 'Paleta de comandos' })
    .locator('.shortcut-combo');
  await expect(paletteCombo).toHaveText('Ctrl+K');
  const saveCombo = page
    .locator('.shortcut-row', { hasText: 'Guardar Markdown' })
    .locator('.shortcut-combo');
  await expect(saveCombo).toHaveText('Ctrl+S');
  await page.keyboard.press('Escape');
  await expect(page.locator('.settings-panel')).toBeHidden();

  // La paleta muestra el comando de Ajustes.
  await page.keyboard.press('Control+k');
  await page.locator('.palette-input').fill('Ajustes');
  await expect(page.locator('.palette-item', { hasText: 'Ajustes' }).first()).toBeVisible();
  await page.keyboard.press('Escape');
});

test('Atajos: reasignar, detectar conflictos y restablecer', async ({ page }) => {
  await page.goto('/');
  await openDoc(page, 'informe.md');
  await expect(page.locator('.md-preview h1')).toBeVisible();
  await page.keyboard.press('Control+Comma');
  await expect(page.locator('.settings-panel')).toBeVisible();

  const closeCombo = page
    .locator('.shortcut-row', { hasText: 'Cerrar pestaña' })
    .locator('.shortcut-combo');

  // Reasignar «Cerrar pestaña» a Ctrl+K entra en conflicto con la paleta.
  await closeCombo.click();
  await expect(page.locator('.shortcut-capture-display')).toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(page.locator('.shortcut-capture-display')).toHaveText('Ctrl+K');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.locator('.dialog-title')).toContainText('Conflicto de atajos');
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await expect(closeCombo).toHaveText('Ctrl+W');

  // Asignar una combinación libre funciona y queda operativa al instante.
  await closeCombo.click();
  await page.keyboard.press('Control+e');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(closeCombo).toHaveText('Ctrl+E');
  await page.keyboard.press('Escape');
  await expect(page.locator('.settings-panel')).toBeHidden();

  await openDoc(page, 'notas.md', '#btn-open');
  await expect(page.locator('.tab')).toHaveCount(2);
  await page.keyboard.press('Control+e');
  await expect(page.locator('.tab')).toHaveCount(1);

  // Restablecer valores por defecto.
  await page.keyboard.press('Control+Comma');
  await page.getByRole('button', { name: 'Restablecer atajos' }).click();
  await page.getByRole('button', { name: 'Restablecer', exact: true }).click();
  await expect(closeCombo).toHaveText('Ctrl+W');
});
