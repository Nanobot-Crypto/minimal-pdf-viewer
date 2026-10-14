/** Impresión local: PDF y documentos HTML mediante el diálogo del sistema. */

import { bridge } from '../core/bridge';

/** Abre el PDF con la aplicación del sistema (impresión de máxima fidelidad). */
export async function printPdfWithSystem(fileId: string): Promise<boolean> {
  return bridge.openWithSystem(fileId);
}

/**
 * Imprime usando un iframe oculto con el propio PDF embebido.
 * Funciona donde el motor de la vista web dispone de visor PDF (WebView2,
 * WebKit con complemento). Si no, el diálogo sale vacío y debe usarse la
 * opción "visora del sistema".
 */
export function printPdfInApp(bytes: Uint8Array, name: string): 'ok' | 'failed' {
  try {
    const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/pdf' });
    return printWithIframe(URL.createObjectURL(blob), name, 'application/pdf');
  } catch {
    return 'failed';
  }
}

/** Imprime un documento HTML (usado para exportar Markdown a PDF). */
export function printHtml(html: string, name: string): 'ok' | 'failed' {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  return printWithIframe(URL.createObjectURL(blob), name, 'text/html');
}

function printWithIframe(url: string, name: string, _type: string): 'ok' | 'failed' {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.title = name;
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:0;border:0';
  iframe.src = url;
  document.body.append(iframe);
  const cleanup = () => {
    setTimeout(() => {
      iframe.remove();
      URL.revokeObjectURL(url);
    }, 60_000);
  };
  iframe.addEventListener('load', () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } finally {
      cleanup();
    }
  });
  iframe.addEventListener('error', cleanup);
  return 'ok';
}
