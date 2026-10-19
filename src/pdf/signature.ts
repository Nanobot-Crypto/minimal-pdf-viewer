/**
 * Firma manuscrita: diálogo de dibujo (ratón o trackpad) y galería local.
 *
 * La firma es **visual, sin validez legal**: se guarda como imagen PNG en el
 * almacenamiento local (`localStorage`) y se coloca en el PDF como sello con
 * apariencia de imagen (anotación `/Stamp` estándar). Nunca sale nada por red.
 */

import { el, clear } from '../ui/dom';
import { icon } from '../ui/icons';
import { SIGN_COLORS } from './annotations';

export interface SavedSignature {
  id: string;
  /** Color con el que se dibujó (para la miniatura). */
  color: string;
  /** PNG como data URL. */
  dataUrl: string;
  created: number;
}

const STORE_KEY = 'vela.signatures';

export function listSignatures(): SavedSignature[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as SavedSignature[];
    return Array.isArray(arr) ? arr.filter((s) => s && typeof s.dataUrl === 'string') : [];
  } catch {
    return [];
  }
}

export function saveSignature(color: string, dataUrl: string): SavedSignature {
  const sig: SavedSignature = {
    id: `sig-${Date.now().toString(36)}`,
    color,
    dataUrl,
    created: Date.now(),
  };
  const all = listSignatures();
  all.push(sig);
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(all));
  } catch {
    /* sin espacio: la firma solo vive en la sesión */
  }
  return sig;
}

export function deleteSignature(id: string): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(listSignatures().filter((s) => s.id !== id)));
  } catch {
    /* nada que hacer */
  }
}

function modalLayer(): HTMLElement {
  let layer = document.getElementById('signature-layer');
  if (!layer) {
    layer = el('div', { id: 'signature-layer', class: 'signature-layer', hidden: true });
    document.body.append(layer);
  }
  return layer;
}

/**
 * Diálogo de dibujo. Devuelve el PNG (data URL) al pulsar «Guardar firma»,
 * o `null` si se cancela.
 */
export function drawSignatureDialog(): Promise<string | null> {
  return new Promise((resolve) => {
    const layer = modalLayer();
    layer.hidden = false;
    clear(layer);

    let color = SIGN_COLORS[0].hex;
    /** Trazos: cada uno es una lista de puntos [x, y]. */
    let strokes: [number, number][][] = [];
    let redoStack: [number, number][][] = [];
    let current: [number, number][] | null = null;

    const canvas = el('canvas', { class: 'signature-canvas', width: '520', height: '200' }) as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;

    const repaint = (): void => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = color;
      for (const stroke of strokes.concat(current ? [current] : [])) {
        if (stroke.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(stroke[0][0], stroke[0][1]);
        for (const [x, y] of stroke.slice(1)) ctx.lineTo(x, y);
        ctx.stroke();
      }
      // Guía de firma.
      ctx.strokeStyle = '#c6c6c0';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(20, 160);
      ctx.lineTo(500, 160);
      ctx.stroke();
    };

    const pos = (e: PointerEvent): [number, number] => {
      const r = canvas.getBoundingClientRect();
      return [
        ((e.clientX - r.left) * canvas.width) / r.width,
        ((e.clientY - r.top) * canvas.height) / r.height,
      ];
    };

    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      current = [pos(e)];
      redoStack = [];
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!current) return;
      current.push(pos(e));
      repaint();
    });
    const finish = (): void => {
      if (current && current.length > 1) strokes.push(current);
      current = null;
      repaint();
    };
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);

    const close = (value: string | null): void => {
      layer.hidden = true;
      clear(layer);
      resolve(value);
    };

    const colorSeg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Color de la firma' });
    for (const c of SIGN_COLORS) {
      const b = el('button', {
        class: `seg-btn${c.id === 'black' ? ' active' : ''}`,
        text: c.label,
        onclick: () => {
          color = c.hex;
          for (const btn of colorSeg.children) btn.classList.remove('active');
          b.classList.add('active');
          repaint();
        },
      });
      colorSeg.append(b);
    }

    const panel = el(
      'div',
      { class: 'signature-panel', role: 'dialog', 'aria-label': 'Dibujar firma' },
      el(
        'div',
        { class: 'signature-head' },
        el('h3', { text: 'Dibujar firma' }),
        el('p', {
          class: 'signature-warn',
          text: '⚠ La firma es visual, sin validez legal. Se guarda solo en este equipo.',
        }),
      ),
      canvas,
      el(
        'div',
        { class: 'signature-actions' },
        colorSeg,
        el('button', {
          class: 'icon-btn',
          title: 'Deshacer trazo',
          'aria-label': 'Deshacer trazo',
          onclick: () => {
            const last = strokes.pop();
            if (last) redoStack.push(last);
            repaint();
          },
        }, icon('undo')),
        el('button', {
          class: 'icon-btn',
          title: 'Rehacer trazo',
          'aria-label': 'Rehacer trazo',
          onclick: () => {
            const last = redoStack.pop();
            if (last) strokes.push(last);
            repaint();
          },
        }, icon('redo')),
        el('button', {
          class: 'icon-btn',
          title: 'Borrar todo',
          'aria-label': 'Borrar todo',
          onclick: () => {
            strokes = [];
            redoStack = [];
            current = null;
            repaint();
          },
        }, icon('trash')),
        el('div', { class: 'spacer' }),
        el('button', { class: 'btn', text: 'Cancelar', onclick: () => close(null) }),
        el('button', {
          class: 'btn btn-primary',
          text: 'Guardar firma',
          onclick: () => {
            finish();
            if (!strokes.length) return close(null);
            close(canvas.toDataURL('image/png'));
          },
        }),
      ),
    );
    layer.append(panel);
    repaint();
  });
}

/**
 * Selector de firmas guardadas. Devuelve la elegida (para colocarla),
 * `{ deleted: id }`… simplificado: devuelve la firma o `null`.
 */
export function pickSignatureDialog(opts: { onDrawNew?: () => void } = {}): Promise<SavedSignature | null> {
  return new Promise((resolve) => {
    const layer = modalLayer();
    layer.hidden = false;
    clear(layer);
    const close = (value: SavedSignature | null): void => {
      layer.hidden = true;
      clear(layer);
      resolve(value);
    };

    const list = el('div', { class: 'signature-list' });
    const render = (): void => {
      clear(list);
      const sigs = listSignatures();
      if (!sigs.length) {
        list.append(el('p', { class: 'sidebar-empty', text: 'No hay firmas guardadas. Pulsa «Dibujar firma».' }));
        return;
      }
      for (const s of sigs) {
        const img = el('img', { class: 'signature-thumb', src: s.dataUrl, alt: 'Firma' }) as HTMLImageElement;
        list.append(
          el(
            'div',
            { class: 'signature-row' },
            img,
            el('button', { class: 'btn', text: 'Usar', onclick: () => close(s) }),
            el('button', {
              class: 'icon-btn',
              title: 'Eliminar firma',
              'aria-label': 'Eliminar firma',
              onclick: () => {
                deleteSignature(s.id);
                render();
              },
            }, icon('trash')),
          ),
        );
      }
    };
    render();

    layer.append(
      el(
        'div',
        { class: 'signature-panel', role: 'dialog', 'aria-label': 'Firmas guardadas' },
        el(
          'div',
          { class: 'signature-head' },
          el('h3', { text: 'Firmas guardadas' }),
          el('p', {
            class: 'signature-warn',
            text: '⚠ Firma visual, sin validez legal. Solo en este equipo.',
          }),
        ),
        list,
        el(
          'div',
          { class: 'signature-actions' },
          el('button', {
            class: 'btn',
            text: 'Dibujar firma nueva',
            onclick: () => {
              close(null);
              opts.onDrawNew?.();
            },
          }),
          el('div', { class: 'spacer' }),
          el('button', { class: 'btn', text: 'Cerrar', onclick: () => close(null) }),
        ),
      ),
    );
  });
}
