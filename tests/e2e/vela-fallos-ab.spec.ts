/**
 * Pruebas E2E de los fallos A y B:
 *  - A: miniaturas correctas (orientación, contenido y proporción) sea cual sea
 *    el orden de los paneles, con el panel oculto al renderizar o al
 *    redimensionar la barra lateral;
 *  - B: el pellizco del trackpad y Ctrl+rueda solo hacen zoom del documento PDF
 *    (nunca de la interfaz) y los gestos de WebKit se consumen siempre.
 */
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

const fixtures = path.join(process.cwd(), 'fixtures');

async function openDoc(page: Page, file: string, trigger?: string): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.locator(trigger ?? '.empty-actions button').first().click();
  const fc = await chooser;
  await fc.setFiles(path.join(fixtures, file));
}

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

/** Todas las miniaturas: pintadas, sin canvas por defecto y con proporción A4. */
function expectThumbsA4(thumbs: ThumbInfo[], expected: number): void {
  expect(thumbs).toHaveLength(expected);
  for (const t of thumbs) {
    expect(t.painted).toBe(true);
    // Sin el canvas por defecto de 300×150 (apaisado y en blanco).
    expect(t.w).not.toBe(300);
    expect(t.h).not.toBe(150);
    expect(t.cssW).toBeGreaterThan(40);
    expect(t.cssH / t.cssW).toBeCloseTo(842 / 595, 1);
    // El backing store sigue la medida CSS (sin contenido diminuto ni estirado).
    expect(Math.abs(t.w / t.cssW - t.h / t.cssH)).toBeLessThan(0.1);
  }
}

async function zoomPct(page: Page): Promise<number> {
  const text = (await page.locator('.pdf-toolbar-zoomlabel').textContent()) ?? '';
  return Number.parseFloat(text.replace('%', ''));
}

/* ------------------------------------------------------------------ */
/* Fallo A: miniaturas al cambiar de panel                             */
/* ------------------------------------------------------------------ */

test('miniaturas: al volver del Índice se pintan todas con su proporción', async ({ page }) => {
  await page.goto('/');
  await openDoc(page, 'ejemplo.pdf');
  await expect(page.locator('.pdfViewer .page canvas').first()).toBeVisible({ timeout: 20_000 });
  await page.locator('#btn-sidebar').click();
  await expect(page.locator('.thumb-cell')).toHaveCount(5);
  await page.waitForTimeout(800);

  // Dos ciclos Índice → Miniaturas: el orden de los paneles no importa.
  for (let i = 0; i < 2; i++) {
    await page.locator('#sidebar-tabs .seg-btn', { hasText: 'Índice' }).click();
    await expect(page.locator('.outline-tree, .sidebar-empty').first()).toBeVisible();
    await page.locator('#sidebar-tabs .seg-btn', { hasText: 'Miniaturas' }).click();
    await expect(page.locator('.thumb-cell')).toHaveCount(5);
    await page.waitForTimeout(900);
    expectThumbsA4(await thumbInfo(page), 5);
  }
});

test('miniaturas: se renderizan al mostrarse el panel, no con display:none', async ({ page }) => {
  await page.goto('/');
  await openDoc(page, 'ejemplo.pdf');
  await expect(page.locator('.pdfViewer .page canvas').first()).toBeVisible({ timeout: 20_000 });

  // El panel lateral arranca cerrado (su cuerpo queda en display:none): las
  // miniaturas de los documentos abiertos así no deben renderizarse a ciegas.
  await expect(page.locator('#sidebar')).toHaveClass(/closed/);
  await openDoc(page, 'formulario.pdf', '#btn-open');
  await expect(page.locator('.annotationLayer input[type="text"]').first()).toBeVisible({
    timeout: 20_000,
  });

  await page.locator('#btn-sidebar').click();
  await expect(page.locator('#sidebar')).not.toHaveClass(/closed/);
  await expect(page.locator('.thumb-cell').first()).toBeVisible();
  await page.waitForTimeout(900);
  expectThumbsA4(await thumbInfo(page), 1);
});

test('miniaturas: se repintan con su proporción al redimensionar el panel', async ({ page }) => {
  await page.goto('/');
  await openDoc(page, 'ejemplo.pdf');
  await expect(page.locator('.pdfViewer .page canvas').first()).toBeVisible({ timeout: 20_000 });
  await page.locator('#btn-sidebar').click();
  await expect(page.locator('.thumb-cell')).toHaveCount(5);
  await page.waitForTimeout(800);

  // Barra lateral más estrecha: las miniaturas se rehacen a la medida nueva
  // sin perder la proporción de la página.
  await page.evaluate(() => {
    (document.getElementById('sidebar') as HTMLElement).style.width = '130px';
  });
  await page.waitForTimeout(900);
  const thumbs = await thumbInfo(page);
  expectThumbsA4(thumbs, 5);
  for (const t of thumbs) expect(t.cssW).toBeLessThan(116);
});

/* ------------------------------------------------------------------ */
/* Fallo B: pellizco y Ctrl+rueda                                      */
/* ------------------------------------------------------------------ */

test('zoom: Ctrl+rueda sobre el PDF acerca el documento, no la interfaz', async ({ page }) => {
  await page.goto('/');
  await openDoc(page, 'ejemplo.pdf');
  await expect(page.locator('.pdfViewer .page canvas').first()).toBeVisible({ timeout: 20_000 });
  const before = await zoomPct(page);

  const prevented = await page.evaluate(() => {
    const target = document.querySelector('.pdf-viewer-container') as HTMLElement;
    const ev = new WheelEvent('wheel', {
      ctrlKey: true,
      deltaY: -100,
      cancelable: true,
      bubbles: true,
    });
    return !target.dispatchEvent(ev); // true ⇒ se llamó a preventDefault
  });
  expect(prevented).toBe(true);
  await expect.poll(async () => zoomPct(page)).toBeGreaterThan(before);

  // La interfaz nunca queda escalada (ni por CSS ni por el WebView).
  const uiZoom = await page.evaluate(() => ({
    body: (document.body as HTMLElement).style.zoom ?? '',
    html: (document.documentElement as HTMLElement).style.zoom ?? '',
    viewport: window.visualViewport?.scale ?? 1,
  }));
  expect(uiZoom.body).toBe('');
  expect(uiZoom.html).toBe('');
  expect(uiZoom.viewport).toBe(1);

  // Con rueda abajo vuelve a alejar el documento.
  const now = await zoomPct(page);
  await page.evaluate(() => {
    const target = document.querySelector('.pdf-viewer-container') as HTMLElement;
    target.dispatchEvent(
      new WheelEvent('wheel', { ctrlKey: true, deltaY: 100, cancelable: true, bubbles: true }),
    );
  });
  await expect.poll(async () => zoomPct(page)).toBeLessThan(now);
});

test('zoom: la rueda sin Ctrl sigue desplazando el documento', async ({ page }) => {
  await page.goto('/');
  await openDoc(page, 'ejemplo.pdf');
  await expect(page.locator('.pdfViewer .page canvas').first()).toBeVisible({ timeout: 20_000 });
  const before = await zoomPct(page);

  const prevented = await page.evaluate(() => {
    const target = document.querySelector('.pdf-viewer-container') as HTMLElement;
    return !target.dispatchEvent(
      new WheelEvent('wheel', { ctrlKey: false, deltaY: 120, cancelable: true, bubbles: true }),
    );
  });
  // Sin Ctrl no se toca nada: el scroll sigue funcionando.
  expect(prevented).toBe(false);
  expect(await zoomPct(page)).toBe(before);
});

test('zoom: en Markdown y en el resto de la interfaz no se escala la aplicación', async ({ page }) => {
  await page.goto('/');
  await openDoc(page, 'informe.md');
  await expect(page.locator('.md-preview h1')).toBeVisible();

  for (const selector of ['.md-preview', '#topbar']) {
    const prevented = await page.evaluate((sel) => {
      const target = document.querySelector(sel) as HTMLElement;
      return !target.dispatchEvent(
        new WheelEvent('wheel', { ctrlKey: true, deltaY: -100, cancelable: true, bubbles: true }),
      );
    }, selector);
    // Se consume el gesto (no puede escalar el WebView)…
    expect(prevented).toBe(true);
    // …pero la interfaz no queda escalada.
    const uiZoom = await page.evaluate(() => ({
      body: (document.body as HTMLElement).style.zoom ?? '',
      html: (document.documentElement as HTMLElement).style.zoom ?? '',
      viewport: window.visualViewport?.scale ?? 1,
    }));
    expect(uiZoom.body).toBe('');
    expect(uiZoom.html).toBe('');
    expect(uiZoom.viewport).toBe(1);
  }
});

test('zoom: los gestos de WebKit (pellizco) se consumen y zooman solo el PDF', async ({ page }) => {
  await page.goto('/');
  await openDoc(page, 'ejemplo.pdf');
  await expect(page.locator('.pdfViewer .page canvas').first()).toBeVisible({ timeout: 20_000 });
  const before = await zoomPct(page);

  const results = await page.evaluate(() => {
    const fire = (type: string, scale: number, target: Element): boolean => {
      const ev = new Event(type, { cancelable: true, bubbles: true });
      Object.defineProperty(ev, 'scale', { value: scale });
      return !target.dispatchEvent(ev); // true ⇒ preventDefault
    };
    const pdf = document.querySelector('.pdf-viewer-container') as HTMLElement;
    return {
      start: fire('gesturestart', 1, pdf),
      change: fire('gesturechange', 1.25, pdf),
      end: fire('gestureend', 1.25, pdf),
    };
  });
  // Los tres eventos se consumen (WebKitGTK no puede ampliar el webview).
  expect(results).toEqual({ start: true, change: true, end: true });
  await expect.poll(async () => zoomPct(page)).toBeGreaterThan(before);
});
