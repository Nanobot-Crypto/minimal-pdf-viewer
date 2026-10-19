/**
 * Panel de Ajustes (Ctrl+,): apariencia, tipografía, guardado y atajos.
 *
 * La interfaz solo edita valores y pregunta al host (App): toda la lógica de
 * normalización, conflictos de atajos y persistencia vive en src/core.
 */

import type { AppSettings, AccentId } from '../core/settings';
import {
  ACCENTS,
  ACCENT_HEX,
  EDITOR_FONTS,
  EDITOR_FONT_SIZE,
  PREVIEW_FONTS,
  PREVIEW_FONT_SIZE,
} from '../core/settings';
import { comboFromEvent, formatCombo, type Combo } from '../core/shortcuts';
import type { ThemePref } from './theme';
import { clear, el } from './dom';
import { confirmDialog } from './dialog';
import { icon } from './icons';

export interface ShortcutCommandInfo {
  id: string;
  title: string;
  section?: string;
}

export interface SettingsHost {
  getSettings(): AppSettings;
  patchSettings(patch: Partial<AppSettings>): void;
  getTheme(): ThemePref;
  setTheme(pref: ThemePref): void;
  listShortcutCommands(): ShortcutCommandInfo[];
  comboFor(commandId: string): Combo | null;
  /** Asigna un combo (`null` = sin atajo). Devuelve el comando desplazado. */
  assignShortcut(commandId: string, combo: Combo | null): string | null;
  resetShortcuts(): void;
  /** Comando que ya usa ese combo (para detectar conflictos). */
  conflictOf(commandId: string, combo: Combo): ShortcutCommandInfo | null;
}

function overlay(): HTMLElement {
  return document.getElementById('settings-overlay')!;
}

/** Manejador de Esc del panel (se retira al cerrar). */
let escHandler: ((e: KeyboardEvent) => void) | null = null;

export function isSettingsOpen(): boolean {
  return !overlay().hidden;
}

export function closeSettingsPanel(): void {
  if (escHandler) {
    window.removeEventListener('keydown', escHandler);
    escHandler = null;
  }
  const layer = overlay();
  layer.hidden = true;
  clear(layer);
}

/** Abre el panel (o lo cierra si ya estaba abierto). */
export function openSettingsPanel(host: SettingsHost): void {
  if (isSettingsOpen()) {
    closeSettingsPanel();
    return;
  }
  const layer = overlay();
  layer.hidden = false;
  clear(layer);

  const body = el('div', { class: 'settings-body' });
  const panel = el(
    'div',
    { class: 'settings-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Ajustes' },
    el(
      'div',
      { class: 'settings-head' },
      el('h2', { class: 'settings-title', text: 'Ajustes' }),
      el('button', {
        class: 'icon-btn',
        title: 'Cerrar',
        'aria-label': 'Cerrar ajustes',
        onclick: () => closeSettingsPanel(),
      }, icon('close')),
    ),
    body,
  );
  layer.append(panel);
  layer.addEventListener('mousedown', (e) => {
    if (e.target === layer) closeSettingsPanel();
  });
  escHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeSettingsPanel();
    }
  };
  window.addEventListener('keydown', escHandler);

  const render = (): void => {
    clear(body);
    body.append(
      appearanceSection(host, render),
      typographySection(host),
      saveSection(host, render),
      diagnosticsSection(host),
      shortcutsSection(host, render),
    );
  };
  render();
}

/* ------------------------------------------------------------------ */
/* Secciones                                                           */
/* ------------------------------------------------------------------ */

function section(title: string, ...children: (HTMLElement | null)[]): HTMLElement {
  return el(
    'section',
    { class: 'settings-section' },
    el('h3', { class: 'settings-section-title', text: title }),
    ...children,
  );
}

function row(label: string, control: HTMLElement, hint?: string): HTMLElement {
  return el(
    'div',
    { class: 'settings-row' },
    el(
      'div',
      { class: 'settings-label' },
      el('span', { text: label }),
      hint ? el('p', { class: 'settings-hint', text: hint }) : null,
    ),
    control,
  );
}

function appearanceSection(host: SettingsHost, render: () => void): HTMLElement {
  const themeSeg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Tema' });
  const themes: { id: ThemePref; label: string }[] = [
    { id: 'light', label: 'Claro' },
    { id: 'dark', label: 'Oscuro' },
    { id: 'system', label: 'Sistema' },
  ];
  for (const t of themes) {
    const btn = el('button', {
      class: `seg-btn${host.getTheme() === t.id ? ' active' : ''}`,
      'aria-pressed': host.getTheme() === t.id ? 'true' : 'false',
      text: t.label,
      onclick: () => {
        host.setTheme(t.id);
        render();
      },
    });
    themeSeg.append(btn);
  }

  const swatches = el('div', { class: 'accent-swatches', role: 'group', 'aria-label': 'Color de acento' });
  for (const a of ACCENTS) {
    const active = host.getSettings().accent === a.id;
    swatches.append(
      el('button', {
        class: `accent-swatch${active ? ' active' : ''}`,
        title: a.label,
        'aria-label': `Acento ${a.label}`,
        'aria-pressed': active ? 'true' : 'false',
        style: `--swatch:${ACCENT_HEX[a.id]}`,
        onclick: () => {
          host.patchSettings({ accent: a.id as AccentId });
          render();
        },
      }),
    );
  }

  return section(
    'Apariencia',
    row('Tema', themeSeg, '«Sistema» sigue el tema del escritorio.'),
    row('Color de acento', swatches),
  );
}

function fontSelect(
  choices: { id: string; label: string }[],
  value: string,
  onChange: (id: string) => void,
): HTMLElement {
  const select = el('select', {
    class: 'settings-select',
    'aria-label': 'Fuente',
    onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value),
  }) as HTMLSelectElement;
  for (const c of choices) {
    const opt = el('option', { value: c.id, text: c.label }) as HTMLOptionElement;
    if (c.id === value) opt.selected = true;
    select.append(opt);
  }
  return select;
}

function sizeSlider(
  value: number,
  range: { min: number; max: number; step: number },
  onChange: (n: number) => void,
): HTMLElement {
  const label = el('span', { class: 'settings-size', text: `${value}px` });
  const input = el('input', {
    class: 'settings-range',
    type: 'range',
    min: String(range.min),
    max: String(range.max),
    step: String(range.step),
    value: String(value),
    'aria-label': 'Tamaño de texto',
    oninput: (e: Event) => {
      const n = Number((e.target as HTMLInputElement).value);
      label.textContent = `${n}px`;
      onChange(n);
    },
  });
  return el('div', { class: 'settings-size-row' }, input, label);
}

function typographySection(host: SettingsHost): HTMLElement {
  const s = host.getSettings();
  return section(
    'Texto Markdown',
    row(
      'Fuente del editor',
      fontSelect(EDITOR_FONTS, s.editorFont, (id) => host.patchSettings({ editorFont: id })),
    ),
    row(
      'Tamaño del editor',
      sizeSlider(s.editorFontSize, EDITOR_FONT_SIZE, (n) => host.patchSettings({ editorFontSize: n })),
    ),
    row(
      'Fuente de la previsualización',
      fontSelect(PREVIEW_FONTS, s.previewFont, (id) => host.patchSettings({ previewFont: id })),
    ),
    row(
      'Tamaño de la previsualización',
      sizeSlider(s.previewFontSize, PREVIEW_FONT_SIZE, (n) =>
        host.patchSettings({ previewFontSize: n }),
      ),
    ),
  );
}

function saveSection(host: SettingsHost, render: () => void): HTMLElement {
  const s = host.getSettings();
  const checkbox = el('input', {
    class: 'settings-check',
    type: 'checkbox',
    'aria-label': 'Autoguardar en el archivo',
  }) as HTMLInputElement;
  checkbox.checked = s.autoSaveToFile;
  checkbox.addEventListener('change', () => {
    void (async () => {
      if (checkbox.checked) {
        // Regla de oro: no se sobrescribe ningún archivo sin confirmación
        // explícita. Aquí es donde se pide, una sola vez, al activarlo.
        const ok = await confirmDialog({
          title: 'Activar el autoguardado en el archivo',
          message:
            'Con el autoguardado activo, Vela sobrescribirá el archivo Markdown ' +
            'con los cambios sin pedirte confirmación en cada guardado. ' +
            '¿Quieres activarlo?',
          confirmText: 'Activar',
          cancelText: 'Cancelar',
          danger: true,
        });
        if (!ok) {
          checkbox.checked = false;
          return;
        }
        host.patchSettings({ autoSaveToFile: true });
      } else {
        host.patchSettings({ autoSaveToFile: false });
      }
      render();
    })();
  });
  return section(
    'Guardado',
    row(
      'Autoguardar en el archivo',
      el('div', { class: 'settings-check-wrap' }, checkbox),
      'Desactivado por defecto. Mientras esté desactivado, los cambios se ' +
        'guardan solo como borrador de recuperación y el archivo original no se toca.',
    ),
  );
}

function diagnosticsSection(host: SettingsHost): HTMLElement {
  const s = host.getSettings();
  const checkbox = el('input', {
    // Clase propia: no debe compartir selector con «Autoguardar» (los tests
    // preexistentes localizan `.settings-check` como único elemento).
    class: 'settings-check-zoomdiag',
    type: 'checkbox',
    'aria-label': 'Registrar eventos de zoom',
  }) as HTMLInputElement;
  checkbox.checked = s.zoomDiagnostics;
  checkbox.addEventListener('change', () => {
    host.patchSettings({ zoomDiagnostics: checkbox.checked });
  });
  return section(
    'Diagnóstico',
    row(
      'Registrar eventos de zoom',
      el('div', { class: 'settings-check-wrap' }, checkbox),
      'Desactivado por defecto. Muestra en pantalla los últimos 20 eventos de ' +
        'zoom (tipo, Ctrl, deltaY, escala y zoom del webview y del PDF) para ' +
        'diagnosticar el pellizco del trackpad. Todo permanece en el equipo.',
    ),
  );
}

function shortcutsSection(host: SettingsHost, render: () => void): HTMLElement {
  const list = el('div', { class: 'shortcut-list' });
  const commands = host.listShortcutCommands();
  let currentSection = '';

  for (const cmd of commands) {
    const sec = cmd.section ?? 'General';
    if (sec !== currentSection) {
      currentSection = sec;
      list.append(el('div', { class: 'shortcut-group', text: sec }));
    }
    const combo = host.comboFor(cmd.id);
    const conflict = combo ? host.conflictOf(cmd.id, combo) : null;
    const comboBtn = el(
      'button',
      {
        class: `shortcut-combo${conflict ? ' conflict' : ''}${combo ? '' : ' empty'}`,
        title: 'Reasignar atajo',
        text: combo ? formatCombo(combo) : 'Sin atajo',
        onclick: () => void reassignFlow(host, cmd, render),
      },
    );
    list.append(
      el(
        'div',
        { class: `shortcut-row${conflict ? ' conflict' : ''}` },
        el('div', { class: 'shortcut-info' },
          el('span', { class: 'shortcut-title', text: cmd.title }),
          conflict ? el('span', { class: 'shortcut-conflict', text: `Conflicto con «${conflict.title}»` }) : null,
        ),
        comboBtn,
      ),
    );
  }

  return section(
    'Atajos de teclado',
    el(
      'div',
      { class: 'settings-row' },
      el(
        'div',
        { class: 'settings-label' },
        el('span', { text: 'Todas las acciones' }),
        el('p', {
          class: 'settings-hint',
          text: 'Pulsa un atajo para reasignarlo. Las combinaciones en conflicto se marcan en rojo.',
        }),
      ),
      el('button', {
        class: 'btn',
        text: 'Restablecer atajos',
        onclick: () => {
          void (async () => {
            const ok = await confirmDialog({
              title: 'Restablecer atajos',
              message:
                'Se descartarán todas tus reasignaciones y se recuperarán los atajos por defecto. ¿Continuar?',
              confirmText: 'Restablecer',
              cancelText: 'Cancelar',
            });
            if (!ok) return;
            host.resetShortcuts();
            render();
          })();
        },
      }),
    ),
    list,
  );
}

/* ------------------------------------------------------------------ */
/* Captura de combinaciones                                            */
/* ------------------------------------------------------------------ */

type CaptureResult = { combo: Combo | null; action: 'save' | 'clear' | 'cancel' };

/**
 * Diálogo de captura: espera una combinación de teclas y la devuelve.
 * Esc cierra sin guardar (por eso Esc no se puede asignar como atajo).
 */
function captureShortcutDialog(title: string, current: Combo | null): Promise<CaptureResult> {
  return new Promise((resolve) => {
    const layer = document.getElementById('dialog-layer')!;
    layer.classList.add('active');
    const backdrop = el('div', { class: 'dialog-backdrop' });
    let captured: Combo | null = null;
    let pressed = false;

    const display = el('div', {
      class: 'shortcut-capture-display',
      text: current ? formatCombo(current) : 'Sin atajo',
    });
    const hint = el('p', {
      class: 'dialog-message',
      text: 'Pulsa la nueva combinación (por ejemplo Ctrl+Mayús+L). Esc cancela.',
    });

    const finish = (result: CaptureResult): void => {
      window.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      if (!layer.childElementCount) layer.classList.remove('active');
      resolve(result);
    };

    const btnClear = el('button', {
      class: 'btn',
      text: 'Quitar atajo',
      onclick: () => finish({ combo: null, action: 'clear' }),
    });
    const btnCancel = el('button', { class: 'btn', text: 'Cancelar', onclick: () => finish({ combo: current, action: 'cancel' }) });
    const btnSave = el('button', {
      class: 'btn btn-primary',
      text: 'Guardar',
      disabled: true,
      onclick: () => finish({ combo: captured, action: 'save' }),
    });

    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        finish({ combo: current, action: 'cancel' });
        return;
      }
      // Solo modificadores: aún no es una combinación completa.
      if (['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) return;
      const captured2 = comboFromEvent(e);
      captured = captured2;
      pressed = true;
      display.textContent = formatCombo(captured2);
      btnSave.disabled = false;
      hint.textContent = `Nueva combinación: ${formatCombo(captured2)}`;
    };

    window.addEventListener('keydown', onKey, true);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop && !pressed) finish({ combo: current, action: 'cancel' });
    });
    backdrop.append(
      el(
        'div',
        { class: 'dialog', role: 'dialog', 'aria-modal': 'true' },
        el('h2', { class: 'dialog-title', text: `Reasignar atajo · ${title}` }),
        hint,
        display,
        el('div', { class: 'dialog-actions' }, btnClear, btnCancel, btnSave),
      ),
    );
    layer.append(backdrop);
    btnSave.focus();
  });
}

async function reassignFlow(host: SettingsHost, cmd: ShortcutCommandInfo, render: () => void): Promise<void> {
  const current = host.comboFor(cmd.id);
  const res = await captureShortcutDialog(cmd.title, current);
  if (res.action === 'cancel') return;
  if (res.action === 'clear') {
    host.assignShortcut(cmd.id, null);
    render();
    return;
  }
  const combo = res.combo;
  if (!combo) return;
  const other = host.conflictOf(cmd.id, combo);
  if (other) {
    const ok = await confirmDialog({
      title: 'Conflicto de atajos',
      message:
        `«${formatCombo(combo)}» ya está asignado a «${other.title}». ` +
        'Si continúas, ese comando se quedará sin atajo. ¿Reasignarlo?',
      confirmText: 'Reasignar',
      cancelText: 'Cancelar',
    });
    if (!ok) return;
  }
  host.assignShortcut(cmd.id, combo);
  render();
}
