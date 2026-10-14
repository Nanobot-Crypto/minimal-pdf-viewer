/** Previsualización Markdown: markdown-it + highlight.js + DOMPurify. */

import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';
import 'highlight.js/styles/github.css';

const md = new MarkdownIt({
  html: false, // El HTML crudo del documento no se interpreta: evita sustos.
  linkify: true,
  breaks: false,
  typographer: false,
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
      } catch {
        /* cae al resaltado genérico */
      }
    }
    return '';
  },
});

export function renderMarkdown(src: string): string {
  return DOMPurify.sanitize(md.render(src), {
    USE_PROFILES: { html: true },
    // Solo recursos locales: nada de redes externas.
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|data:image\/|blob:|\.\/|\/|#)/i,
    ADD_ATTR: ['target', 'rel', 'class'],
  });
}

export interface HeadingInfo {
  level: number;
  text: string;
  line: number;
}

/** Esquema del documento a partir del texto fuente (barato y exacto). */
export function extractHeadings(src: string): HeadingInfo[] {
  const out: HeadingInfo[] = [];
  const lines = src.split('\n');
  let inFence = false;
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) return;
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) {
      out.push({ level: m[1].length, text: m[2].replace(/[#*`[\]]/g, '').trim(), line: i });
    }
  });
  return out;
}

/** Convierte el HTML renderizado en un documento HTML independiente. */
export function standaloneHtml(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light; }
  body {
    max-width: 46rem;
    margin: 3rem auto;
    padding: 0 1.25rem 6rem;
    font-family: Charter, Georgia, "Times New Roman", serif;
    font-size: 17px;
    line-height: 1.7;
    color: #1c1c1e;
    background: #fff;
  }
  h1, h2, h3, h4 { font-family: system-ui, sans-serif; line-height: 1.25; }
  code { font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; font-size: .9em; background: #f4f4f2; padding: .12em .35em; border-radius: 4px; }
  pre { background: #f4f4f2; padding: 14px 16px; border-radius: 8px; overflow: auto; }
  pre code { background: none; padding: 0; }
  blockquote { margin: 1em 0; padding: .25em 1em; border-left: 3px solid #c9c9c4; color: #55555c; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th, td { border: 1px solid #ddd; padding: .45em .7em; text-align: left; }
  th { background: #f6f6f4; }
  img { max-width: 100%; height: auto; }
  a { color: #0b57d0; }
  hr { border: none; border-top: 1px solid #ddd; margin: 2em 0; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
