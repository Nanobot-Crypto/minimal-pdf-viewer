# Arquitectura y decisiones técnicas

## Resumen

Vela es una aplicación de escritorio construida con **Tauri 2** (nativo ligero +
webview) y un frontend web en **TypeScript sin framework**, elegido por su bajo
consumo de memoria y su arranque rápido. El mismo bundle funciona en navegador
(modo desarrollo/pruebas) gracias a una capa de abstracción de plataforma.

```
vela/
├── index.html              Shell: barra superior, panel lateral, contenido, estado
├── src/
│   ├── main.ts             Arranque
│   ├── app.ts              Shell, pestañas, comandos, sesión, DnD, persistencia
│   ├── core/
│   │   ├── bridge.ts       Adaptador Tauri ⇄ navegador (archivos, estado, sistema)
│   │   ├── state.ts        Estado persistente + sesión (con debounce)
│   │   ├── tabs.ts         Modelo de pestañas (puro y testeable)
│   │   ├── shortcuts.ts    Atajos de teclado → comandos
│   │   ├── fuzzy.ts        Coincidencia difusa de la paleta
│   │   ├── store.ts        Store mínimo pub/sub
│   │   └── types.ts        Tipos compartidos
│   ├── ui/                 DOM: iconos, diálogos, menús, paleta, temas, estados
│   ├── pdf/                viewer.ts (pdf.js), thumbnails, outline, print, pdfTab
│   ├── md/                 editor.ts (CodeMirror), preview, export, mdTab
│   └── styles/             base.css, pdf.css, md.css (variables de tema)
├── src-tauri/              Rust: comandos locales, configuración, iconos
├── tests/                  Vitest (unitarias) + Playwright (E2E)
└── scripts/                Generación de fixtures e iconos
```

## Decisiones principales

### ¿Por qué Tauri y no Electron o una app nativa?

- **Consumo:** Tauri usa el webview del sistema (~10-40 MB de instalación frente a
  150+ MB de Electron) y arranca notablemente más rápido.
- **Privacidad:** superficie de red nula por diseño; el proceso Rust solo expone
  comandos de archivos locales.
- **Accesibilidad multiplataforma** con un único frontend web, que además permite
  ejecutar y probar la interfaz sin compilar Rust.

Si el entorno de compilación no dispone de Rust/GTK, el frontend sigue siendo
ejecutable y testeable en navegador (es la vía usada para las pruebas de este
repositorio; ver LIMITATIONS.md).

### Motor PDF: pdf.js

- Es el renderizador PDF de referencia en web (lo usa Firefox), maduro y local.
- Capa de texto real → selección, copia y búsqueda con resaltado.
- Renderizado por página con cancelación → documentos grandes con memoria acotada.
- Se usa el viewer genérico (`PDFViewer` + `PDFFindController` + `PDFLinkService`),
  sin la app completa de pdf.js, para mantener el control del interfaz.
- Miniaturas propias con `IntersectionObserver` (el export `PDFThumbnailViewer` no
  está disponible en el build ESM de pdfjs-dist 4.x): solo se renderizan las
  visibles.

### Markdown: markdown-it + CodeMirror 6 + DOMPurify

- `markdown-it`: render rápido y extensible; `html: false` → el HTML crudo del
  documento nunca se interpreta.
- `DOMPurify`: segunda barrera; solo se permiten URI http(s)/mailto/data:image/
  blob/relativas. Ningún recurso remoto se carga por defecto.
- `highlight.js` (subconjunto `common`) para resaltado de bloques de código.
- CodeMirror 6: editor modular (~peso contenido), historial, búsqueda interna,
  solo lectura y temas propios claros/oscuros.

### Capa `bridge` (Tauri ⇄ navegador)

Toda operación de archivos/persistencia pasa por `src/core/bridge.ts`:

| Operación | Tauri | Navegador |
| --- | --- | --- |
| Abrir archivos | `@tauri-apps/plugin-dialog` (nativo) | `showOpenFilePicker` → `<input type=file>` |
| Abrir carpeta | diálogo nativo + `vela_read_dir` (Rust) | `showDirectoryPicker` → `webkitdirectory` |
| Leer/escribir | comandos Rust (`vela_read_file`, `vela_write_file`) | `FileSystemFileHandle` / descarga |
| Estado de sesión | `vela-state.json` en app_config_dir | `localStorage` |
| Abrir con sistema | `xdg-open` / `open` / `start` | no disponible |

El frontend no distingue flujos de usuario: `App` trabaja con `PickedFile` y rutas
lógicas. Esto permite pruebas E2E reales del 95 % del código sin empaquetar.

### Estado y ciclo de vida de las pestañas

- `Tab` guarda estado de vista (página, zoom, rotación, scroll, cursor, modo MD) y
  el borrador Markdown sin guardar.
- Las vistas (`PdfDocView`, `MdDocView`) se crean al activar la pestaña (carga
  perezosa) y sobreviven al cambio de pestaña (se desmontan del DOM, no se
  destruyen), de modo que volver es instantáneo.
- `StatePersistence` guarda con debounce (400 ms) y al cerrar la ventana.
- La sesión solo incluye pestañas reabribles (rutas absolutas) o con borrador.

### Comandos y atajos

Un único registro `Command` (id, título, sección, atajo, disponibilidad, ejecución)
alimenta a la vez la paleta de comandos (Ctrl+K), el teclado global y los menús.
Así los atajos, la paleta y el menú contextual nunca se desincronizan.

### Diseño de interfaz

- Barra superior compacta (40 px) con pestañas de 28 px; contenido a pantalla
  completa; barra de estado discreta (26 px).
- Controles del PDF en barra flotante que aparece con el ratón y se oculta en reposo.
- Modo claro/oscuro por variables CSS + `data-theme`; respeta `prefers-color-scheme`.
- Tipografía: interfaz `system-ui`, lectura Markdown `Charter/Georgia`, código
  monoespaciada.
- Estados vacío / error / protegido / carga con acciones claras.

### Estructura de bundles

`vite.config.ts` separa chunks (`pdf`, `codemirror`) para carga progresiva:
`index.js` pequeño + cargas diferidas según el tipo de documento.
