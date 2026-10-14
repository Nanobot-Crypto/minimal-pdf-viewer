# Limitaciones y funciones no implementadas

Documento honesto de lo que falta, lo que funciona de forma parcial y por qué.

## Compilación nativa no ejecutada en este entorno

El código Rust de `src-tauri/` sigue el API estable de Tauri 2 y está documentado
para compilarse en cualquier equipo o CI (ver BUILD.md), pero **no se pudo compilar
ni empaquetar en el entorno donde se generó este repositorio**: no incluye toolchain
de Rust ni las dependencias de sistema `webkit2gtk`/GTK, y no hay permisos para
instalarlas. El frontend sí se construye (`npm run build`), se prueba
(`npm test`, `npm run test:e2e`) y se verifica visualmente.

Riesgo residual: errores de compilación menores en `src-tauri/` al primer
`cargo build` en una máquina con el toolchain completo. No hay riesgo de diseño
conocido.

## Impresión y exportación a PDF

- **Imprimir PDF:** se ofrece «Abrir con la aplicación del sistema» (fidelidad
  total: usa el visor/impresora del SO) y «Imprimir desde Vela» (iframe con el PDF).
  La segunda vía depende de que el motor de la vista web incluya visor PDF
  (WebView2 sí; WebKitGTK puede mostrar el diálogo vacío). En Tauri la opción
  recomendada es la del sistema.
- **Markdown → PDF:** se implementa mediante el diálogo de impresión del navegador
  del sistema («Guardar como PDF») sobre el HTML exportado con estilos. Es el
  camino estable sin dependencias pesadas (no se incluye wkhtmltopdf ni Chrome
  headless). No hay motor de paginación propio.
- Imprimir PDFs de cientos de páginas desde Vela puede consumir mucha memoria
  (todo el documento se sirve al visor de impresión).

## Asociaciones de archivos y sesiones

- Windows/Linux: los documentos abiertos con «Abrir con» llegan como argumentos y
  se abren al arrancar.
- **macOS:** los eventos «Open With» de Finder no llegan como argumentos en Tauri 2
  y no se manejan (habría que añadir `tauri-plugin-deep-link` + instancia única).
- No hay instancia única: abrir un documento con la app ya ejecutándose crea una
  segunda ventana/instancia.
- La restauración de sesión reabre documentos por ruta absoluta. Si un archivo se
  movió o borró, la pestaña aparece con un estado «no disponible» y un botón para
  volver a localizarlo.

## Modo navegador (desarrollo/pruebas)

- Los identificadores de archivo del diálogo moderno no son persistentes: tras
  recargar, las pestañas no se reabren solas (sí aparecen en «Recientes»).
- Guardar un Markdown nuevo puede caer en «descargar archivo» si el navegador no
  soporta File System Access API.
- No hay «abrir con el sistema» ni rutas absolutas.

## Markdown

- El HTML crudo del documento **no se interpreta** (`html: false` + DOMPurify):
  decisión de seguridad; no es posible incrustar HTML personalizado.
- No hay vista previa de sintaxis extendida más allá del CommonMark + tablas +
  enlaces automáticos: sin footnotes, sin MathJax/LaTeX, sin diagramas Mermaid.
- Las listas de tareas se muestran como texto (`- [ ]`), sin casillas interactivas.
- Las imágenes de rutas relativas se resuelven y embeben en escritorio; en modo
  navegador solo se muestran si el archivo ya está disponible en la sesión.
- No hay visor de imágenes independiente ni editor de tablas asistido.

## PDF

- No hay edición de formulararios, anotaciones, firmas ni OCR (búsqueda solo sobre
  la capa de texto del PDF).
- Las contraseñas de documentos cifrados se piden al abrir y no se recuerdan.
- No hay modo presentación ni vista en dos páginas (se priorizó la lectura continua).
- La búsqueda es secuencial sin «resaltado global persistente» más allá del
  resaltado de pdf.js (todas las coincidencias se marcan; la navegación es
  anterior/siguiente).

## Interfaz

- Sin personalización de temas propios más allá de claro/oscuro/sistema.
- Sin arranque minimizado, bandeja del sistema ni «siempre visible».
- El reordenado de pestañas usa arrastre nativo HTML5 (funcional, algo menos fluido
  que un implementado con punteros).
- La paleta de comandos no incluye búsqueda de texto dentro de documentos abiertos
  (el buscador de cada documento cubre ese caso).

## Pruebas

- Unitarias: lógica de pestañas, estado/sesión, atajos, coincidencia difusa y
  pipeline Markdown.
- E2E (Playwright, modo navegador): estado vacío y recientes, PDF (render,
  navegación, zoom, búsqueda, miniaturas), Markdown (edición, previsualización,
  modos), paleta + tema oscuro, pestañas (cambios sin guardar, confirmación de
  cierre, menú contextual).
- No automatizadas (requieren empaquetar): diálogos nativos, asociaciones de
  archivo, impresión real, drag & drop desde el explorador del sistema,
  rendimiento con PDFs de 500+ páginas.
