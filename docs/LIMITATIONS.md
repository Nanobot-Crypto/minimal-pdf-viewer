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
- **E2E:** la suite completa está en verde (35/35) tras el pulido de la Parte 2.
  Los 4 tests que antaño dependían del panel lateral ya pasan con el
  comportamiento vigente (el panel se abre con `#btn-sidebar` y recuerda su
  sección por pestaña).
- No automatizadas (requieren empaquetar): diálogos nativos, asociaciones de
  archivo, impresión real, drag & drop desde el explorador del sistema,
  rendimiento con PDFs de 500+ páginas y los comandos Rust nuevos de
  `vela-docstore.json`.

## Zoom con pellizco en WebKitGTK (Tauri): verificación en el equipo real pendiente

El pellizco del trackpad y Ctrl+rueda se defienden en varias capas (viewport +
`touch-action`, listeners no pasivos con `preventDefault` para `wheel`+Ctrl,
`gesturestart/change/end` y pulsaciones de dos dedos, y en Rust el zoom nativo
del webview fijado a 1.0 + `GtkGestureZoom` reclamando el gesto y emitiendo
`zoom-webview`). En navegador (Chromium) está cubierto por pruebas unitarias y
e2e; **la validación final en Debian + WebKitGTK con el bundle compilado sigue
pendiente** (este entorno no compila Rust ni tiene webkit2gtk). Si el pellizco
sigue ampliando la interfaz, activa **Ajustes → Diagnóstico → «Registrar eventos
de zoom»** y manda una captura del panel.

## Anotaciones de texto (resaltar/subrayar/tachar) — implementadas en esta tanda

Hecho: herramientas de resaltar/subrayar/tachar con cuatro colores (amarillo,
verde, rosa, azul), barra con seleccionar/mover/borrar/deshacer/rehacer y
«Guardar copia con anotaciones» como PDF con anotaciones estándar (visibles en
Evince), conservando los valores de formulario rellenos. Al reabrir la copia se
ven y se pueden editar. Vía: **modelo propio + pdf-lib** (ver
docs/ARCHITECTURE.md): el editor de pdf.js 4.10 solo crea resaltados, así que se
generan diccionarios PDF estándar (`/Highlight`, `/Underline`, `/StrikeOut` con
`/QuadPoints`). El original nunca se sobrescribe sin confirmación.

Límites conocidos de esta tanda:

- La copia se anota desde los bytes originales cargados: si el archivo cambió en
  disco mientras estaba abierto, la copia parte de la versión abierta.
- Las anotaciones NO se guardan automáticamente en ningún sitio: si cierras sin
  «Guardar copia con anotaciones», se descartan (a diferencia de las notas
  locales, que sí se persisten).
- Lápiz a mano alzada (Ink) **no implementado** (era opcional). Extensible vía
  `ANN_TOOLS` (ver ARCHITECTURE.md).
- Mover anotaciones existentes de un PDF ajeno funciona, pero no se garantiza la
  fidelidad de apariencias heredadas (otros lectores pueden regenerarlas).
- La firma, los comentarios y los tipos de campo nuevos quedan para la Parte 2.

## Anotaciones: pruebas pendientes de la tanda anterior

- **E2E pendientes (preexistentes):** los 4 tests de
  `tests/e2e/vela-mejoras.spec.ts` que dependen de que el panel lateral esté
  abierto sin abrirlo siguen fuera de esta tanda (ver descripción en la versión
  anterior de este documento).

## Parte 2: firma, comentarios, formas y estado de pestañas

- **Tarea 0 (estado de pestañas):** implementada y con e2e. Salvedad: si la
  ventana se redimensiona con la pestaña en segundo plano y el zoom estaba en
  modo «ajustar al ancho/página», al volver se reajusta al tamaño nuevo (es el
  comportamiento del modo); los modos de escala personalizada y las posiciones
  de página/scroll sí se conservan exactos.
- **Firma:** visual, **sin validez legal** (así se avisa en la interfaz). Se
  guarda en `localStorage` (no sincroniza entre equipos). Las firmas colocadas
  se conservan al reabrir la copia como sellos, pero **no se re-editan** en
  Vela (se pueden borrar solo antes de guardar). La colocación es en el centro
  de la página actual (sin modo «colocar bajo el cursor»).
- **Comentarios:** sin icono personalizable (fijo 💬), sin respuestas/hilos ni
  autor/fecha (Parte 2 futura). El texto se edita con doble clic.
- **Formas:** relleno no soportado (solo borde); grosor fijo de 1,5 pt en la
  creación (editable en código). La línea/flecha se dibuja de extremo a extremo.
- Pruebas unitarias de la Parte 2 añadidas en `tests/annotations.test.ts`;
  e2e de firma/comentarios/formas **no escritas** (sin tiempo).

## Pulido posterior (lápiz, pruebas y firma)

- **Lápiz a mano alzada (Ink):** implementado (color y grosor, `/Ink` estándar,
  sin zoom ni scroll al dibujar). Sin presión sensible ni suavizado de trazo.
- **Pruebas:** e2e nuevas de la Parte 2 (`tests/e2e/parte2.spec.ts`) y arreglo
  del e2e flakante de la Tarea 0 (la sincronización con el render perezoso de
  pdf.js ahora espera al cambio real de página por la barra de estado y ancla
  el scroll al offset de la página).
- **Firma:** el selector de firmas ya permite «Dibujar firma nueva» sin pasar
  por la paleta. Siguen pendientes: re-editar sellos ya guardados al reabrir y
  colocar bajo el cursor (se coloca en el centro de la página actual).
