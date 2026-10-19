# Arquitectura de Vela — anotaciones de PDF y zoom (Tarea A / Parte 1)

Este documento describe las piezas añadidas en esta tanda y **dónde tocar para
ampliarlas en la Parte 2** (firma, comentarios y formularios interactivos).

## Tarea A: zoom con pellizco (capas de defensa)

El requisito: el pellizco del trackpad debe hacer **zoom del PDF** (misma lógica
y límites que Ctrl+rueda y Ctrl++) y nunca escalar la interfaz. En WebKitGTK el
gesto lo puede gestionar el motor antes que el JavaScript, por lo que se defiende
en varias capas (todas activas a la vez):

| Capa | Archivo(s) | Qué hace |
| --- | --- | --- |
| 1. HTML/CSS | `index.html`, `src/styles/zoom.css` | `<meta viewport … user-scalable=no>` y `touch-action: pan-x pan-y` (sin `pinch-zoom`) en toda la interfaz; `pan-y` en el documento PDF. |
| 2. JavaScript | `src/ui/zoomGestures.ts` | Listeners **no pasivos y en captura** con `preventDefault` para `wheel`+Ctrl, `gesturestart/change/end` de WebKit y pulsaciones de **dos dedos** (`touchstart/move/end`). Sobre el PDF el factor se aplica con `PdfView.zoomBy` (límites 0.15–5, factor por evento acotado a 0.5–2, pellizco táctil suavizado con EMA de distancia, `PINCH_SMOOTH_ALPHA`). Además `wireZoomHotkeyGuard` bloquea el zoom nativo con Ctrl++, Ctrl+- y Ctrl+0 (`zoomHotkeysEnabled: false` en `tauri.conf.json` lo refuerza). |
| 3. Rust (Tauri 2) | `src-tauri/src/main.rs` (`mod zoom_guard`), `src-tauri/Cargo.toml` | Con `WebviewWindow::with_webview` → `PlatformWebview::inner()` (WebView de webkit2gtk): (a) zoom del webview fijado a 1.0 y repuesto si cambia (sondeo cada 250 ms), (b) `GtkGestureZoom` en fase de captura que **reclama la secuencia** (WebKitGTK no debe escalar) y emite el evento `zoom-webview` con el factor, y (c) si el zoom nativo cambió igualmente, se repone a 1.0 y se emite el factor observado. |

El frontend aplica los eventos `zoom-webview` al PDF activo
(`App.wireNativeZoomBridge`) y descarta duplicados JS↔nativo con una ventana de
400 ms. El mismo mecanismo sirve para futuras ampliaciones: basta escuchar el
evento y llamar a `zoomBy`.

### Modo diagnóstico

Ajuste **«Registrar eventos de zoom»** (`settings.zoomDiagnostics`, apagado por
defecto). Al activarlo aparece el panel `src/ui/zoomLog.ts` con los **últimos 20
eventos**: tipo (`wheel`/`gesture`/`touch`/`hotkey`/`webview`), `ctrlKey`,
`deltaY`, escala, factor aplicado, zoom del webview (lo reporta Rust) y zoom del
PDF. Para ampliar: `recordZoomEvent(info, extra)` acepta campos nuevos sin tocar
la interfaz.

## Tarea B: anotaciones de texto (resaltar / subrayar / tachar)

### Vía elegida: mezcla de pdf-lib + modelo propio (y por qué)

- **No** se usó el editor de anotaciones de pdf.js (`AnnotationEditorUIManager`):
  en pdfjs-dist 4.10 **solo crea resaltados** (los tipos underline/strikeout no
  existen en su editor) y su serializado depende de formatos internos.
- **Sí** se usa **pdf-lib** (empaquetada, offline) para escribir **anotaciones
  PDF estándar** — `/Highlight`, `/Underline` y `/StrikeOut` con `/QuadPoints`,
  `/C` (color) y flag `/F 4` (imprimible) — que Evince y demás lectores muestran
  sin nada especial. Al ser diccionarios estándar, al reabrir la copia pdf.js
  las renderiza y Vela las vuelve a cargar en el modelo (editables).
- El modelo de interfaz (herramientas, colores, selección, mover, borrar,
  deshacer/rehacer) es propio y puro: `src/pdf/annotations.ts` (geometría y
  `AnnotationStore`) + `src/pdf/annLayer.ts` (capa DOM por página).

### Piezas y dónde ampliarlas (Parte 2)

| Pieza | Archivo | Ampliación |
| --- | --- | --- |
| Registro de herramientas | `src/pdf/annotations.ts` → `ANN_TOOLS` | Añadir una entrada por herramienta nueva (id, etiqueta, icono, subtipo PDF). Es el punto de extensión natural para **firma** (p. ej. tipo `stamp`/`signature`) y **comentarios** (p. ej. tipo `text`). |
| Colores | `ANN_COLORS` (amarillo, verde, rosa, azul) | Añadir colores; la barra los pinta sola. |
| Modelo con historial | `AnnotationStore` (`add`/`remove`/`move`/`undo`/`redo`) | Operaciones nuevas = nuevos `AnnOp` en la pila de deshacer. |
| Geometría | `rectsToQuads`, `quadToViewportRect`, `translateQuads` | Reutilizable para cualquier marca ancla a texto/cajas. |
| Guardado | `saveAnnotatedPdf` (pdf-lib) | Añadir el serializado del tipo nuevo (p. ej. `/Ink` para lápiz, `/Widget` para formularios) en el mismo bucle. Los **valores de formulario** ya se copian (`collectFormValues` en `src/pdf/forms.ts` → `FormFieldValue[]`): Tx (texto), Btn (casilla/radio) y Ch (lista). |
| Lectura al reabrir | `annotationsFromPdfjsData` | Mapear subtipos nuevos (`Ink`, `Text`, `Widget`…) al modelo. |
| Barra de herramientas | `PdfDocView.renderAnnToolbar` (`src/pdf/pdfTab.ts`) | Se genera desde `ANN_TOOLS` + `ANN_COLORS`: al registrar herramientas nuevas aparecen solas. Los botones de deshacer/rehacer/borrar/guardar ya están. |
| Guardado con confirmación | `PdfDocView.saveAnnotatedCopy` | Mismo flujo que `saveFormCopy`: proponer nombre `*-anotado.pdf`, y **nunca** sobrescribir el original u otro archivo sin confirmación explícita. |

### Flujo de guardado de la copia

1. `collectFormValues(doc)` recoge los valores rellenos (`annotationStorage` de
   pdf.js) por nombre de campo.
2. `saveAnnotatedPdf({ originalBytes, annotations, formValues })` carga los bytes
   originales con pdf-lib, aplica los valores de formulario (sin romper el
   guardado si un campo no se reconoce) y añade las anotaciones estándar.
3. El destino se elige con `bridge.resolveSaveTarget` («Guardar como»); si el
   destino es el original o ya existe → diálogo de confirmación.

### Atajos de teclado

Comandos registrados en `App.commands()` (sección **Anotaciones**, aparecen en
la paleta y en Ajustes → Atajos, reasignables): `doc.annSelect`,
`doc.annHighlight`, `doc.annUnderline`, `doc.annStrikeout`, `doc.annDelete`,
`doc.annUndo`, `doc.annRedo`, `doc.saveAnnotatedCopy`. Sin atajo por defecto a
propósito (evita conflictos con el texto y el editor Markdown); el usuario puede
asignarlos desde Ajustes.

## Pruebas

- `tests/zoom-gestures.test.ts`: factores de rueda/gesto/táctil con límites,
  suavizado EMA, consumo de eventos y modo diagnóstico.
- `tests/annotations.test.ts`: geometría selección→quads, modelo con
  deshacer/rehacer, lectura de anotaciones del PDF y guardado con pdf-lib
  (subtipos estándar presentes en el PDF resultante).
- `tests/e2e/vela-fallos-ab.spec.ts` (preexistente) + nuevas e2e de anotaciones
  y diagnóstico: Ctrl+rueda cambia el zoom del PDF y no el de la interfaz.


# Parte 2: firma, comentarios y formas

## Estado de pestañas (Tarea 0)

Causa del fallo: `renderContent()` **desatacha y reengancha** el elemento de la
vista al cambiar de pestaña (`clear()` + `append()`), lo que resetea el scroll
del contenedor (PDF y CodeMirror) y deja el zoom/página solo guardados en `tab`
sin volver a aplicarse. Fix:

- `PdfDocView.restore()` / `MdDocView.restore()`: se ejecutan al reactivar la
  pestaña (tras dos `requestAnimationFrame`, con la vista visible y con tamaño
  real) y reaplican **página, zoom/mode de ajuste, scroll** (PDF) y **modo de
  vista, scroll del editor y de la previsualización y cursor** (Markdown).
  Con un re-aplicado tardío (150 ms) para el scroll máximo que cambia al
  re-medar (CodeMirror) y al renderizar páginas (pdf.js).
- `activateTab()` ya guardaba con `saveState()`; ahora `saveState()` de
  Markdown guarda también scroll y modo (`tab.mdEditorScroll`,
  `tab.mdPreviewScroll`, `tab.mdMode` en `src/core/types.ts`).
- El panel lateral recuerda su sección **por pestaña**
  (`App.sidebarViewByTab`): índice/miniaturas/comentarios/marcadores/notas.

E2E: `tests/e2e/tarea0-tabs.spec.ts` (PDF↔MD, MD↔MD, resize en segundo plano y
sección del panel lateral).

## Modelo ampliado (`src/pdf/annotations.ts`)

`PdfAnnot` es una unión con discriminante `type`:

| Tipo | Contenido | PDF estándar al guardar | Relectura |
| --- | --- | --- | --- |
| `highlight`/`underline`/`strikeout` | `quads` (texto) | `/Highlight` `/Underline` `/StrikeOut` + `/QuadPoints` | ✅ |
| `shape` (`rect`/`ellipse`/`line`/`arrow`) | `rect` (para línea/flecha: extremos sin normalizar, conserva dirección), `color`, `thickness` | `/Square`, `/Circle`, `/Line` (+`/LE /OpenArrow` para flecha), `/BS` con grosor | ✅ |
| `comment` | punto `x,y` + `text` | `/Text` (nota adhesiva, `/Name /Comment`, `/Contents`) | ✅ |
| `image` (`kind: 'signature'`) | `dataUrl` PNG + `rect` | `/Stamp` con `/AP` (apariencia que dibuja el PNG) | se conserva al re-guardar (no se re-edita) |

Operaciones del `AnnotationStore`: `add`/`remove`/`move` (snapshots completos
`from`/`to`, sirve para mover **y** redimensionar) + `undo`/`redo`.

## Firma (visual, sin validez legal)

- `src/pdf/signature.ts`: diálogo de dibujo (canvas + pointer events) con
  color negro/azul, **deshacer/rehacer de trazos** y borrar; galería en
  `localStorage` (`vela.signatures`) con vista previa, «Usar» y «Eliminar».
- Colocación: `placeSignature()` la sitúa en el centro de la página actual;
  se mueve arrastrando y se redimensiona con el tirador **manteniendo la
  proporción**; se borra con Supr/papelera. Aviso en la interfaz: «firma
  visual, sin validez legal».
- Extender (Parte 2 futura, p. ej. firma desde imagen/certificado): nuevas
  entradas en el diálogo + serializador en `saveAnnotatedPdf`.

## Comentarios y formas

- Comentario: botón 💬 de la barra o comando `doc.annComment`; se ancla a un
  punto de la página; doble clic para editar el texto; lista en el panel
  lateral (**Comentarios**) con navegación por clic. No se mezclan con las
  notas locales (`src/core/notes.ts`).
- Formas: herramientas de la barra (rectángulo, elipse, línea, flecha) con
  color (mismas muestras) y grosor; se dibujan por arrastre, se
  seleccionan/mueven/redimensionan/boran con los mismos controles.
- Todo entra en «Guardar copia con anotaciones» y en el deshacer/rehacer.

## Atajos (Parte 2)

Comandos registrados (sin atajo por defecto, reasignables desde Ajustes, sección
Anotaciones): `doc.shapeRect`, `doc.shapeEllipse`, `doc.shapeLine`,
`doc.shapeArrow`, `doc.annComment`, `doc.signaturePlace`, `doc.signatureDraw`
(más los de la Parte 1).

## Lápiz a mano alzada (Ink) — añadido en el pulido

- `InkAnnotation` (`type: 'ink'`) con `strokes: number[][]` (trazos de puntos
  [x, y] en espacio PDF), `color` y `thickness` (pt). El grosor se elige en la
  barra (1/1,5/3/5 pt) y es común con las formas.
- Dibujo: herramienta ✒ de la barra (`ActiveTool = 'ink'`); el arrastre se
  consume (`preventDefault` + `stopPropagation`): dibujar **no hace zoom ni
  scroll**. Puntos muestreados en espacio PDF (independiente del zoom).
- Render: `<svg>` con `polyline` por trazo (capa de anotaciones, se recoloca al
  cambiar el zoom).
- Guardado: anotación estándar `/Ink` con `/InkList`, `/C`, `/BS` (grosor) y
  flag `/F 4` → visible en Evince. Relectura al reabrir la copia vía `inkList`
  de pdf.js. Mueve/redimensiona/borra/deshacer igual que el resto.

## Pruebas (estado final)

- Unitarias: `tests/zoom-gestures.test.ts` (18) · `tests/annotations.test.ts`
  (14: geometría, modelo, relectura, guardado de texto/formas/comentarios/
  lápiz/firma con subtipos estándar verificados con pdf-lib) · resto de suites
  sin cambios en verde.
- E2E nuevas: `tests/e2e/tarea0-tabs.spec.ts` (estado de pestañas) y
  `tests/e2e/parte2.spec.ts` (resaltar + deshacer/rehacer + copia con
  `/Highlight`; formas y lápiz con borrado; comentarios con edición y panel
  lateral; firma completa con copia `/Stamp`; modo diagnóstico de zoom).
