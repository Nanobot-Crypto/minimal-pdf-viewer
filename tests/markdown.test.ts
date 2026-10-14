/** Pruebas del pipeline Markdown: render, esquema y exportación. */

import { describe, expect, it } from 'vitest';
import { escapeHtml, extractHeadings, renderMarkdown, standaloneHtml } from '../src/md/preview';

describe('renderMarkdown', () => {
  it('renderiza títulos, listas, tablas, citas y código', () => {
    const html = renderMarkdown(
      [
        '# Título',
        '',
        '- uno',
        '- dos',
        '',
        '> una cita',
        '',
        '| a | b |',
        '| - | - |',
        '| 1 | 2 |',
        '',
        '```js',
        'const x = 1;',
        '```',
      ].join('\n'),
    );
    expect(html).toContain('<h1>');
    expect(html).toContain('<li>');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<table>');
    expect(html).toContain('<pre>');
    expect(html).toContain('hljs');
  });

  it('convierte enlaces e imágenes pero no ejecuta HTML crudo', () => {
    const html = renderMarkdown(
      '[enlace](https://example.com) <script>alert(1)</script> <img src="x.png" onerror="alert(2">',
    );
    expect(html).toContain('href="https://example.com"');
    // El HTML crudo se escapa: no quedan etiquetas activas.
    expect(html).not.toMatch(/<(script|img)\b/i);
    expect(html).toContain('&lt;script&gt;');
  });

  it('no permite esquemas javascript:', () => {
    const html = renderMarkdown('[click](javascript:alert(1))');
    expect(html).not.toMatch(/href\s*=\s*["']?javascript:/i);
    // El texto literal se escapa como contenido inofensivo.
    expect(html).toContain('[click]');
  });
});

describe('extractHeadings', () => {
  it('extrae jerarquía ignorando bloques de código', () => {
    const src = ['# Uno', '```', '# no es título', '```', '## Dos', '### Tres'].join('\n');
    const heads = extractHeadings(src);
    expect(heads.map((h) => h.text)).toEqual(['Uno', 'Dos', 'Tres']);
    expect(heads[0].level).toBe(1);
    expect(heads[1].line).toBe(4);
  });
});

describe('standaloneHtml', () => {
  it('genera un documento completo y escapa el título', () => {
    const doc = standaloneHtml('a <b> & c', '<p>hola</p>');
    expect(doc).toContain('<!doctype html>');
    expect(doc).toContain('a &lt;b&gt; &amp; c');
    expect(doc).toContain('<p>hola</p>');
  });

  it('escapeHtml cubre los caracteres sensibles', () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  });
});
