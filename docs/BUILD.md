# Compilar y empaquetar Vela

## 1. Dependencias

### Comunes

```bash
npm install
```

### Escritorio (Tauri 2)

1. **Rust** ≥ 1.77: <https://rustup.rs>
2. **Sistema:**

| Sistema | Paquetes |
| --- | --- |
| Debian/Ubuntu | `sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev` |
| Fedora | `dnf install webkit2gtk4.1-devel openssl-devel curl wget file libappindicator-gtk3-devel librsvg2-devel` |
| Arch | `pacman -S webkit2gtk-4.1 base-devel curl wget file openssl appmenu-gtk-module libappindicator-gtk3 librsvg` |
| macOS | Xcode Command Line Tools (`xcode-select --install`) |
| Windows | Visual Studio Build Tools («Desktop development with C++») + WebView2 (incluido en Windows 11) |

3. **CLI de Tauri** (opcional pero recomendado):

```bash
npm install -D @tauri-apps/cli
```

## 2. Desarrollo

```bash
npm run dev            # frontend puro en http://localhost:5199
npm run tauri:dev      # ventana nativa con recarga en caliente
```

`tauri dev` ejecuta automáticamente `beforeDevCommand` (`npm run dev`) y sirve el
frontend desde `devUrl`.

## 3. Pruebas

```bash
npm run typecheck      # TypeScript estricto
npm test               # unitarias: vitest (jsdom)
npm run fixtures       # regenera fixtures/ejemplo.pdf, informe.md, notas.md
npm run test:e2e       # Playwright: flujos + capturas en docs/screenshots/
```

### Navegadores de Playwright

En un equipo normal:

```bash
npx playwright install chromium
```

Si los navegadores ya están instalados en otra ruta (p. ej. `/opt/ms-playwright`),
expón la variable antes de ejecutar las pruebas:

```bash
PLAYWRIGHT_BROWSERS_PATH=/ruta/a/navegadores npm run test:e2e
```

`playwright.config.ts` usa automáticamente `.cache/pw` del proyecto si existe.

## 4. Compilar la aplicación

```bash
npm run build          # genera dist/ (frontend)
npm run tauri:build    # compila Rust + empaqueta
```

Salidas habituales en `src-tauri/target/release/bundle/`:

- **Linux:** `deb/vela_0.1.0_amd64.deb`, `appimage/Vela_0.1.0_amd64.AppImage`
- **Windows:** `msi/Vela_0.1.0_x64_en-US.msi`, `nsis/Vela_0.1.0_x64-setup.exe`
- **macOS:** `dmg/Vela_0.1.0_aarch64.dmg`, `dmg/Vela_0.1.0_x64.dmg`

La compilación es nativa: hay que empaquetar en cada sistema de destino (o usar
CI; ver §6).

## 5. Iconos

Los iconos ya están generados en `src-tauri/icons/` (PNG + ICO + ICNS). Para
regenerarlos desde el SVG del proyecto:

```bash
PLAYWRIGHT_BROWSERS_PATH=.cache/pw node scripts/gen-icons.mjs
```

## 6. CI (referencia)

Un job de GitHub Actions por sistema (ubuntu-latest, windows-latest, macos-latest):

```yaml
- uses: actions/checkout@v4
- uses: actions/setup-node@v4
  with: { node-version: 22 }
- uses: dtolnay/rust-toolchain@stable
- run: npm install
- run: npm run typecheck && npm test
- uses: tauri-apps/tauri-action@v0
  with:
    tagName: v$VERSION
    releaseDraft: true
```

## 7. Asociación de archivos

`src-tauri/tauri.conf.json` declara `bundle.fileAssociations` para `.pdf`, `.md`,
`.markdown` y `.mdown`. Al instalar el paquete, el sistema operativo ofrece Vela en
«Abrir con» y en el menú contextual de esos archivos.

Al lanzar la aplicación con documentos (doble clic o «Abrir con»), las rutas llegan
como argumentos y se abren automáticamente al arrancar.

> **Nota macOS:** los eventos «Open With» de Finder no llegan como argumentos en
> Tauri 2. Ver [LIMITATIONS.md](LIMITATIONS.md).

## 8. Solución de problemas

| Síntoma | Causa probable | Solución |
| --- | --- | --- |
| `webkit2gtk-4.1` no encontrado | Faltan dependencias de Tauri | Instalar paquetes de §1 |
| Playwright: `browser not found` | Navegadores sin instalar | `npx playwright install chromium` |
| El worker de pdf.js no carga | Ruta de assets incorrecta | `base: './'` debe mantenerse en `vite.config.ts` |
| Ventana en blanco al empaquetar | `frontendDist` incorrecto | Debe ser `../dist` respecto a `src-tauri/` |
