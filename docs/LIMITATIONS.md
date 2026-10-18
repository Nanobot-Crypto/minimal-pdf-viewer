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
conocido. En esta tanda se añadieron dos comandos nuevos (`vela_load_docstore`,
`vela_save_docstore`) con la misma forma que `vela_load_notes`/`vela_save_notes`;
siguen sin compilar en este entorno por el mismo motivo.

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

- Tema claro/oscuro/sistema **con color de acento** (seis opciones) y tipografía
  del editor y la previsualización configurables desde Ajustes. No hay temas
  completos propios ni importación de estilos CSS externos.
- Sin arranque minimizado, bandeja del sistema ni «siempre visible».
- El reordenado de pestañas usa arrastre nativo HTML5 (funcional, algo menos fluido
  que un implementado con punteros).
- La paleta de comandos no incluye búsqueda de texto dentro de documentos abiertos
  (el buscador de cada documento cubre ese caso).

## Posición de lectura (PDF)

- La posición (página, zoom y modo de ajuste) se guarda **por identificador de
  documento**: ruta absoluta en escritorio, clave `nombre+tamaño+fecha` en
  navegador. Si el archivo se mueve o renombra, la posición anterior no se
  encuentra y el documento se abre al principio (no falla: simplemente no hay
  nada que restaurar).
- Si el contenido del PDF cambió (más/menos páginas), la página restaurada se
  recorta al total real; puede que la posición ya no tenga sentido para el
  documento nuevo, pero nunca impide abrirlo.
- No se guarda el desplazamiento fino dentro de la página ni el documento cifrado
  con contraseña (sí página/zoom, una vez abierto).

## Autoguardado y borradores (Markdown)

- Los borradores de recuperación se guardan en un almacén local propio
  (`vela-docstore.json` / `localStorage`), **nunca** en el archivo original, con
  escritura al dejar de escribir (~1 s), un repaso cada 15 s y al cerrar. Si el
  proceso muere en el instante justo de escribir, se puede perder el último
  segundo de edición.
- Cerrar una pestaña con cambios sin guardar conserva el borrador (red de
  seguridad); se ofrece «Restaurar borrador / Descartar» al reabrir el documento.
  El borrador se elimina al guardar el archivo o al pulsar «Descartar».
- «Autoguardar en el archivo» está **desactivado por defecto** y solo se activa
  con confirmación explícita. Una vez activo, escribe en el archivo sin pedir
  confirmación en cada guardado (la confirmación inicial es la autorización).
  En modo navegador sin File System Access API, cada guardado puede caer en la
  descarga del navegador (limitación ya documentada para «Guardar»).

## Ajustes y atajos

- La captura de atajos usa el teclado: no se pueden asignar botones del ratón
  ni la tecla Esc (Esc cierra el diálogo de captura).
- Los atajos son globales por comando: no hay atajos por contexto (PDF/Markdown)
  más allá de la disponibilidad del comando, ni perfiles de usuario.
- El tamaño de fuente se elige entre 10–28 px (editor) y 12–30 px (vista previa),
  y la fuente entre pila local del sistema: no se descargan fuentes externas.

## Pruebas

- Unitarias: lógica de pestañas, estado/sesión (incluidos ajustes), atajos
  (con reasignaciones y conflictos), coincidencia difusa, pipeline Markdown y
  el almacén por documento (posiciones y borradores: saneado, recortes y
  persistencia).
- E2E (Playwright, modo navegador): estado vacío y recientes, PDF (render,
  navegación, zoom, búsqueda, miniaturas), Markdown (edición, previsualización,
  modos), paleta + tema oscuro, pestañas (cambios sin guardar, confirmación de
  cierre, menú contextual), posición de lectura del PDF, borradores de
  recuperación, autoguardado en archivo y panel de Ajustes (tema, acento,
  tipografía, reasignación de atajos con conflictos y restablecer).
- **E2E pendientes (preexistentes a esta tanda):** los 4 tests de
  `tests/e2e/vela-mejoras.spec.ts` que dependen de que el panel lateral esté
  abierto sin abrirlo («paleta: las opciones ejecutan su función…», «esquema
  Markdown…», «notas PDF…», «notas Markdown…») fallan también en el commit
  `d19edcb` (Vela 0.2.0) sin cambios: esperan una autoapertura del panel lateral
  que la aplicación nunca implementó, y sus expectativas son contradictorias
  entre sí sobre el estado inicial del panel (unos lo quieren abierto y otro
  cerrado tras el mismo flujo). Requieren decidir el comportamiento deseado del
  panel lateral y ajustar tests o app: queda fuera de esta tanda.
- No automatizadas (requieren empaquetar): diálogos nativos, asociaciones de
  archivo, impresión real, drag & drop desde el explorador del sistema,
  rendimiento con PDFs de 500+ páginas y los comandos Rust nuevos de
  `vela-docstore.json`.

## Zoom con pellizco en WebKitGTK (Tauri): verificación pendiente

El pellizco del trackpad y Ctrl+rueda se consumen en el lado web (eventos
`wheel` con `ctrlKey` y gestos de WebKit `gesturestart`/`gesturechange`/
`gestureend`, todos con `preventDefault`), y en Tauri se desactiva además el
zoom nativo del webview con `zoomHotkeysEnabled: false` en la ventana. En
navegador (Chromium) está cubierto por pruebas; **la validación final en
Debian + WebKitGTK queda pendiente** de ejecutar en un equipo con el bundle de
Tauri compilado.

## Anotaciones de texto (resaltar/subrayar/tachar) — NO implementadas en esta tanda

Queda pendiente la tanda de anotaciones (herramienta de resaltar/subrayar/tachar
con colores, barra mínima con deshacer/rehacer y «Guardar copia con
anotaciones»). Vía elegida para implementarla: el **editor de anotaciones
propio de pdf.js** (`AnnotationEditorUIManager` + modos de texto de pdfjs-dist
4.x), porque ya dibuja la selección de texto con los cuatro colores, gestiona
selección/borrado y deshacer/rehacer, y `PDFDocumentProxy.saveDocument()`
serializa esas anotaciones como anotaciones PDF estándar junto a los valores de
formulario ya rellenos (mismo flujo de «guardar copia» con confirmación que el
guardado de formularios). No se usó pdf-lib para no duplicar lógica de selección
de texto ni de quad points, y porque pdf.js garantiza que lo que se ve en el
visor es lo que se guarda. Falta: barra de herramientas mínima (herramienta +
color), comando «Guardar copia con anotaciones» y pruebas.
