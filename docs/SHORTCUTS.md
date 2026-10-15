# Atajos de teclado: cómo se registran y se personalizan

Vela resuelve el teclado con un único registro de combinaciones (`combo → id de
comando`). Los mismos comandos alimentan la paleta (Ctrl+K), el teclado global,
los menús y la lista de **Ajustes → Atajos de teclado**, de modo que nunca se
desincronizan.

## Formato de una combinación (`Combo`)

La cadena sale de `comboFromEvent()` (`src/core/shortcuts.ts`): modificadores en
orden **Ctrl, Alt, Shift** y la tecla final. `Ctrl` cubre también `Cmd` (Meta) en
macOS. Ejemplos:

| Pulsación | Combo |
| --- | --- |
| Ctrl+K | `Ctrl+k` |
| Ctrl+Mayús+P | `Ctrl+Shift+p` |
| Ctrl+Coma | `Ctrl+,` |
| Ctrl++ (zoom) | `Ctrl++` |
| Espacio | `Space` |
| Ctrl+Tab | `Ctrl+Tab` |

Para mostrarla en la interfaz se usa `formatCombo()` (`Ctrl+Shift+p` →
`Ctrl+Mayús+P`).

## Registrar un comando con atajo (tandas futuras)

1. **Añade el comando** en `App.commands()` (`src/app.ts`): `id`, `title`,
   `section`, `enabled` (opcional) y `run`. Con esto ya aparece en la paleta y
   en **Ajustes → Atajos de teclado**, donde el usuario puede asignarle un
   atajo desde la interfaz.

2. **(Opcional) Atajo por defecto:** añade una línea en `GLOBAL_SHORTCUTS`
   (`src/core/shortcuts.ts`):

   ```ts
   'Ctrl+Shift+l': 'doc.micomando',
   ```

   Si no añades nada, el comando queda «Sin atajo» pero es reasignable.

3. **(Solo si debe funcionar mientras se escribe)** añade el id al conjunto
   `TYPING_ALLOWED` de `src/app.ts`. Sin esto, el atajo se ignora cuando el
   foco está en un campo de texto o en el editor (evita robar teclas mientras
   se escribe).

4. **Etiqueta en paleta y menús:** en el comando, usa
   `hint: this.hintFor('doc.micomando')`. El texto se actualiza solo cuando el
   usuario reasigna el atajo.

5. **Pruebas:** en `tests/shortcuts.test.ts`/`tests/settings.test.ts` se puede
   comprobar el valor por defecto y la ausencia de conflictos
   (`findShortcutConflicts()` debe devolver `[]`).

Ejemplo completo mínimo:

```ts
// src/app.ts — dentro de commands()
{
  id: 'doc.micomando',
  title: 'Mi comando',
  section: 'Documento',
  hint: this.hintFor('doc.micomando'),
  run: () => this.miMetodo(),
},

// src/core/shortcuts.ts — dentro de GLOBAL_SHORTCUTS
'Ctrl+Shift+l': 'doc.micomando',
```

## Personalización por el usuario (Ajustes)

- **Ajustes → Atajos de teclado** lista todos los comandos con su combinación
  vigente. Al pulsar el chip del atajo se captura una nueva combinación.
- Si la combinación ya pertenece a otro comando, Vela avisa del **conflicto** y
  solo la roba con confirmación explícita (el otro comando se queda sin atajo).
- «Restablecer atajos» descarta todas las reasignaciones.
- Un comando puede quedarse sin atajo («Quitar atajo» en el diálogo de captura).

Las reasignaciones viven en `settings.shortcutOverrides`
(`id de comando → combo | null`) dentro del estado persistido
(`vela-state.json` en escritorio, `localStorage` en navegador). Nunca se
modifican los valores por defecto del código.

## Resolución de teclas en ejecución

```ts
resolveShortcut(evento, extras?, overrides?)
```

1. Mira el `combo` del evento.
2. Comprueba `extras` (alias puntuales, p. ej. `Ctrl+=` para zoom).
3. Consulta el mapa vigente `effectiveShortcutMap(overrides)`, que fusiona
   `GLOBAL_SHORTCUTS` con las reasignaciones del usuario (una reasignación
   sustituye también al combo por defecto del comando).

Funciones de apoyo (todas puras y con pruebas en `tests/settings.test.ts`):
`comboFor`, `defaultComboFor`, `conflictFor`, `reassignShortcut`,
`findShortcutConflicts`, `resetShortcutOverrides`, `sanitizeShortcutOverrides`,
`formatCombo`.
