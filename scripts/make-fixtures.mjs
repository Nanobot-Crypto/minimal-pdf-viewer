/**
 * Genera los documentos de prueba (fixtures) en `fixtures/`:
 *  - ejemplo.pdf  → 5 páginas con títulos, texto, una tabla y una imagen.
 *  - informe.md   → Markdown con tablas, código, citas, listas e imagen.
 *  - notas.md     → documento corto para pruebas de pestañas.
 *
 * Uso: node scripts/make-fixtures.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'fixtures');
fs.mkdirSync(path.join(out, 'img'), { recursive: true });

/* ------------------------------- PDF ------------------------------- */

// PNG de 1×1 válido (pixel rojo) para incrustar como imagen.
const pngB64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const pngBytes = Uint8Array.from(Buffer.from(pngB64, 'base64'));
fs.writeFileSync(path.join(out, 'img', 'muestra.png'), pngBytes);

const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);
const mono = await doc.embedFont(StandardFonts.Courier);
const png = await doc.embedPng(pngBytes);

const pages = [
  {
    title: 'Vela — documento de ejemplo',
    body: [
      'Este PDF se genera automáticamente para probar el visor Vela.',
      'Contiene varias páginas, títulos, una tabla, una imagen y bloques de código.',
      'La navegación por páginas, el zoom y la búsqueda deben funcionar sin red.',
    ],
  },
  {
    title: 'Capítulo 1 · Velocidad de apertura',
    body: [
      'Un visor sobrio debe abrir documentos en pocos segundos, incluso grandes.',
      'La memoria debe permanecer baja: solo se renderizan las páginas visibles.',
      'El texto es seleccionable y copiable porque la capa de texto está activa.',
    ],
  },
  {
    title: 'Capítulo 2 · La mariposa monarca',
    body: [
      'La mariposa monarca migra miles de kilómetros cada otoño.',
      'Este párrafo incluye la palabra mariposa para las pruebas de búsqueda.',
      'Buscar «mariposa» debe señalar esta página como coincidencia principal.',
    ],
  },
  {
    title: 'Capítulo 3 · Tablas y datos',
    body: ['La siguiente tabla resume las funciones principales del visor.'],
    table: [
      ['Función', 'Estado'],
      ['Navegación', 'disponible'],
      ['Búsqueda', 'disponible'],
      ['Impresión', 'disponible'],
    ],
  },
  {
    title: 'Capítulo 4 · Imagen y código',
    body: ['Debajo se incrusta una imagen de prueba y un bloque de código.'],
    code: ['function hola() {', '  return "mundo";', '}'],
  },
];

pages.forEach((spec, i) => {
  const page = doc.addPage([595, 842]); // A4 en puntos
  const { width, height } = page.getSize();
  page.drawText(spec.title, {
    x: 56,
    y: height - 90,
    size: 20,
    font: bold,
    color: rgb(0.11, 0.11, 0.12),
  });
  let y = height - 130;
  for (const line of spec.body) {
    page.drawText(line, { x: 56, y, size: 12, font, color: rgb(0.2, 0.2, 0.22) });
    y -= 26;
  }
  if (spec.table) {
    y -= 10;
    spec.table.forEach((row, r) => {
      row.forEach((cell, c) => {
        page.drawText(cell, {
          x: 56 + c * 200,
          y,
          size: 11,
          font: r === 0 ? bold : font,
          color: rgb(0.15, 0.15, 0.17),
        });
      });
      page.drawLine({
        start: { x: 56, y: y - 6 },
        end: { x: 56 + 380, y: y - 6 },
        thickness: 0.5,
        color: rgb(0.8, 0.8, 0.78),
      });
      y -= 24;
    });
  }
  if (spec.code) {
    y -= 10;
    for (const line of spec.code) {
      page.drawText(line, { x: 64, y, size: 11, font: mono, color: rgb(0.1, 0.35, 0.25) });
      y -= 18;
    }
    y -= 8;
  }
  if (i === pages.length - 1) {
    page.drawImage(png, { x: 56, y: y - 60, width: 60, height: 60 });
    page.drawText('Imagen de prueba incrustada', { x: 128, y: y - 30, size: 11, font });
  }
  page.drawText(`Página ${i + 1} de ${pages.length}`, {
    x: width - 130,
    y: 40,
    size: 10,
    font,
    color: rgb(0.5, 0.5, 0.52),
  });
});

fs.writeFileSync(path.join(out, 'ejemplo.pdf'), await doc.save());

/* ------------------- PDF grande (prueba de rendimiento) ------------------- */

const big = await PDFDocument.create();
for (let i = 1; i <= 120; i++) {
  const page = big.addPage([595, 842]);
  const { height } = page.getSize();
  page.drawText(`Documento extenso — página ${i}`, {
    x: 56,
    y: height - 90,
    size: 18,
    font: bold,
  });
  for (let l = 0; l < 28; l++) {
    page.drawText(
      `Línea ${l + 1} de la página ${i}: texto de relleno para verificar el renderizado perezoso.`,
      { x: 56, y: height - 130 - l * 22, size: 11, font },
    );
  }
  page.drawText(`Página ${i} de 120`, { x: 470, y: 40, size: 10, font });
}
fs.writeFileSync(path.join(out, 'grande.pdf'), await big.save());

/* ----------------------------- Markdown ----------------------------- */

fs.writeFileSync(
  path.join(out, 'informe.md'),
  `# Informe de pruebas

> Documento Markdown de ejemplo para Vela: tablas, código, citas, listas e imágenes.

## Características visibles

1. Títulos con jerarquía
2. Listas ordenadas y sin ordenar
3. Tablas alineadas
4. Bloques de código con resaltado
5. Enlaces como [documentación de Vela](https://example.com/vela)

- Elemento rápido
- Elemento ligero
- Elemento discreto

## Tabla de formatos

| Formato | Extensión | Comentario        |
| ------- | --------- | ----------------- |
| PDF     | .pdf      | lectura y búsqueda |
| Markdown| .md       | edición y lectura  |

## Código

\`\`\`ts
export function saludar(nombre: string): string {
  return \`Hola, \${nombre}\`;
}
\`\`\`

\`\`\`python
def suma(a, b):
    """Devuelve la suma de dos números."""
    return a + b
\`\`\`

## Cita

La sobriedad no es menos diseño: es el diseño exactamente donde hace falta.

## Imagen relativa

![Muestra](./img/muestra.png)

---

*Generado automáticamente por \`scripts/make-fixtures.mjs\`.*
`,
);

fs.writeFileSync(
  path.join(out, 'notas.md'),
  `# Notas rápidas

- [ ] Revisar el índice del PDF
- [x] Comprobar el modo oscuro

Texto breve para pruebas de pestañas y guardado.
`,
);

console.log('Fixtures generados en', out);
