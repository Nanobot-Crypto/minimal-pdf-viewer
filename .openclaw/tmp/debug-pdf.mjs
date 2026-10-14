/** Depuración manual: abre el PDF de fixtures y vuelca consola/estado. */
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '../..');
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(root, '.cache', 'pw');

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', (m) => console.log('[console]', m.type(), m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto('http://localhost:5198/');
await page.waitForTimeout(500);
console.log('estado inicial:', await page.locator('#content').innerHTML().then((h) => h.slice(0, 200)));

const chooser = page.waitForEvent('filechooser');
await page.locator('.empty-actions button').first().click();
const fc = await chooser;
await fc.setFiles(path.join(root, 'fixtures', 'ejemplo.pdf'));
await page.waitForTimeout(6000);

console.log('clases contenido:', await page.locator('#content').getAttribute('class'));
console.log('html contenido:', (await page.locator('#content').innerHTML()).slice(0, 800));
console.log('status:', await page.locator('#status-right').textContent());
console.log('paginas pdf.js:', await page.locator('.pdfViewer .page').count());
await page.screenshot({ path: path.join(root, '.openclaw/tmp/debug-pdf.png') });
await browser.close();
