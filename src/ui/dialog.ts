/** Diálogos modales sobrios: confirmar, aviso y captura de texto. */

import { el } from './dom';

interface DialogOpts {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  input?: { placeholder?: string; value?: string; password?: boolean };
}

function layer(): HTMLElement {
  return document.getElementById('dialog-layer')!;
}

function close(node: HTMLElement): void {
  node.remove();
  if (!layer().childElementCount) layer().classList.remove('active');
}

function shell(): HTMLElement {
  layer().classList.add('active');
  return el('div', { class: 'dialog-backdrop' });
}

export type DialogChoice = 'confirm' | 'cancel' | 'dismiss';

/**
 * Como `confirmDialog`, pero distingue el cierre sin decidir (Esc o clic
 * fuera) de la cancelación explícita: útil cuando «cancelar» borra datos.
 */
export function confirmDialogEx(opts: DialogOpts): Promise<DialogChoice> {
  return new Promise((resolve) => {
    const backdrop = shell();
    const btnConfirm = el('button', {
      class: `btn ${opts.danger ? 'btn-danger' : 'btn-primary'}`,
      text: opts.confirmText ?? 'Aceptar',
    });
    const btnCancel = el('button', { class: 'btn', text: opts.cancelText ?? 'Cancelar' });
    const finish = (v: DialogChoice) => {
      close(backdrop);
      resolve(v);
    };
    btnConfirm.addEventListener('click', () => finish('confirm'));
    btnCancel.addEventListener('click', () => finish('cancel'));
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) finish('dismiss');
    });
    backdrop.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') finish('dismiss');
    });
    backdrop.append(
      el(
        'div',
        { class: 'dialog', role: 'dialog', 'aria-modal': 'true' },
        el('h2', { class: 'dialog-title', text: opts.title }),
        opts.message ? el('p', { class: 'dialog-message', text: opts.message }) : null,
        el('div', { class: 'dialog-actions' }, btnCancel, btnConfirm),
      ),
    );
    layer().append(backdrop);
    btnConfirm.focus();
  });
}

export function confirmDialog(opts: DialogOpts): Promise<boolean> {
  return confirmDialogEx(opts).then((choice) => choice === 'confirm');
}

export function infoDialog(opts: { title: string; message: string }): Promise<void> {
  return new Promise((resolve) => {
    const backdrop = shell();
    const btn = el('button', { class: 'btn btn-primary', text: 'Entendido' });
    const finish = () => {
      close(backdrop);
      resolve();
    };
    btn.addEventListener('click', finish);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) finish();
    });
    backdrop.append(
      el(
        'div',
        { class: 'dialog', role: 'dialog', 'aria-modal': 'true' },
        el('h2', { class: 'dialog-title', text: opts.title }),
        el('p', { class: 'dialog-message', text: opts.message }),
        el('div', { class: 'dialog-actions' }, btn),
      ),
    );
    layer().append(backdrop);
    btn.focus();
  });
}

export function promptDialog(opts: DialogOpts): Promise<string | null> {
  return new Promise((resolve) => {
    const backdrop = shell();
    const input = el('input', {
      class: 'dialog-input',
      type: opts.input?.password ? 'password' : 'text',
      placeholder: opts.input?.placeholder ?? '',
      value: opts.input?.value ?? '',
      'aria-label': opts.title,
    });
    const btnConfirm = el('button', {
      class: 'btn btn-primary',
      text: opts.confirmText ?? 'Aceptar',
    });
    const btnCancel = el('button', { class: 'btn', text: opts.cancelText ?? 'Cancelar' });
    const finish = (v: string | null) => {
      close(backdrop);
      resolve(v);
    };
    btnConfirm.addEventListener('click', () => finish(input.value));
    btnCancel.addEventListener('click', () => finish(null));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(input.value);
      if (e.key === 'Escape') finish(null);
    });
    backdrop.append(
      el(
        'div',
        { class: 'dialog', role: 'dialog', 'aria-modal': 'true' },
        el('h2', { class: 'dialog-title', text: opts.title }),
        opts.message ? el('p', { class: 'dialog-message', text: opts.message }) : null,
        input,
        el('div', { class: 'dialog-actions' }, btnCancel, btnConfirm),
      ),
    );
    layer().append(backdrop);
    input.focus();
    input.select();
  });
}

/** Diálogo con área de texto multilínea (notas). Devuelve `null` al cancelar. */
export function textareaDialog(opts: DialogOpts): Promise<string | null> {
  return new Promise((resolve) => {
    const backdrop = shell();
    const input = el('textarea', {
      class: 'dialog-textarea',
      placeholder: opts.input?.placeholder ?? '',
      rows: '6',
      'aria-label': opts.title,
    }) as HTMLTextAreaElement;
    input.value = opts.input?.value ?? '';
    const btnConfirm = el('button', {
      class: 'btn btn-primary',
      text: opts.confirmText ?? 'Guardar',
    });
    const btnCancel = el('button', { class: 'btn', text: opts.cancelText ?? 'Cancelar' });
    const finish = (v: string | null) => {
      close(backdrop);
      resolve(v);
    };
    btnConfirm.addEventListener('click', () => finish(input.value.trim() ? input.value : null));
    btnCancel.addEventListener('click', () => finish(null));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') finish(null);
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) finish(input.value.trim() ? input.value : null);
    });
    backdrop.append(
      el(
        'div',
        { class: 'dialog', role: 'dialog', 'aria-modal': 'true' },
        el('h2', { class: 'dialog-title', text: opts.title }),
        opts.message ? el('p', { class: 'dialog-message', text: opts.message }) : null,
        input,
        el('div', { class: 'dialog-actions' }, btnCancel, btnConfirm),
      ),
    );
    layer().append(backdrop);
    input.focus();
  });
}
