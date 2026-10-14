/** Exportación Markdown → HTML / PDF (vía impresión local). */

import { bridge, baseName, dirName } from '../core/bridge';
import type { WriteResult } from '../core/types';
import { printHtml } from '../pdf/print';
import { renderMarkdown, standaloneHtml } from './preview';

export function buildExportHtml(title: string, mdSource: string): string {
  return standaloneHtml(title, renderMarkdown(mdSource));
}

/**
 * Exporta a HTML en la ruta indicada. Si el destino existe pide al llamante
 * confirmación (overwrite) — nunca se sobrescribe en silencio.
 */
export async function exportHtmlTo(
  targetId: string,
  title: string,
  mdSource: string,
  overwrite = false,
): Promise<WriteResult> {
  return bridge.writeText(targetId, buildExportHtml(title, mdSource), { overwrite });
}

/** Abre el diálogo de impresión para guardar como PDF. */
export function exportPdfViaPrint(title: string, mdSource: string): 'ok' | 'failed' {
  return printHtml(buildExportHtml(title, mdSource), title);
}

/**
 * Sustituye las imágenes de rutas relativas por data URLs leyéndolas desde la
 * carpeta del documento. En navegador solo funcionan las imágenes absolutas
 * (limitación documentada).
 */
export async function inlineLocalImages(
  html: string,
  docFileId: string,
): Promise<string> {
  const dir = dirName(docFileId);
  if (!dir) return html;
  const matches = [...html.matchAll(/<img[^>]+src="([^"]+)"/g)];
  let out = html;
  for (const m of matches) {
    const src = m[1];
    if (/^(https?:|data:|blob:)/i.test(src)) continue;
    try {
      const rel = src.replace(/^\.\//, '');
      const bytes = await bridge.readBytes(`${dir}/${rel}`);
      const mime = /\.(png)$/i.test(rel)
        ? 'image/png'
        : /\.(jpe?g)$/i.test(rel)
          ? 'image/jpeg'
          : /\.(gif)$/i.test(rel)
            ? 'image/gif'
            : /\.(webp)$/i.test(rel)
              ? 'image/webp'
              : /\.(svg)$/i.test(rel)
                ? 'image/svg+xml'
                : 'application/octet-stream';
      const b64 = bytesToBase64(bytes);
      out = out.replace(m[0], m[0].replace(src, `data:${mime};base64,${b64}`));
    } catch {
      /* imagen no disponible: se mantiene el texto alternativo */
    }
  }
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/** Nombre propuesto para el archivo exportado. */
export function exportNameFor(docId: string, ext: 'html' | 'pdf'): string {
  return baseName(docId).replace(/\.(md|markdown|mdown)$/i, '') + `.${ext}`;
}
