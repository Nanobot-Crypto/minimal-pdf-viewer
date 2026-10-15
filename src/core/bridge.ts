/**
 * Capa de abstracción de plataforma (bridge).
 *
 * - En escritorio (Tauri) usa comandos propios de Rust: diálogos nativos,
 *   lectura/escritura de archivos y persistencia en el directorio de la app.
 * - En navegador (modo de desarrollo / pruebas) usa File System Access API
 *   cuando existe y un `<input type=file>` como respaldo, con estado en
 *   localStorage. Ninguna variante envía datos fuera del equipo.
 */

import type { DirEntryInfo, DocKind, OpenFilter, PickedFile, WriteResult } from './types';

export const isTauri: boolean =
  typeof window !== 'undefined' &&
  // Tauri v2 expone esta marca en el contexto de la ventana.
  ((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ !== undefined);

export function kindFromName(name: string): DocKind | null {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'md' || ext === 'markdown' || ext === 'mdown') return 'md';
  return null;
}

export function baseName(id: string): string {
  const norm = id.replace(/\\/g, '/');
  const i = norm.lastIndexOf('/');
  return i >= 0 ? norm.slice(i + 1) : norm;
}

export function dirName(id: string): string {
  const norm = id.replace(/\\/g, '/');
  const i = norm.lastIndexOf('/');
  return i >= 0 ? norm.slice(0, i) : '';
}

function isAbsolutePath(id: string): boolean {
  return /^\//.test(id) || /^[a-zA-Z]:[\\/]/.test(id);
}

/* ------------------------------------------------------------------ */
/* Núcleo común                                                        */
/* ------------------------------------------------------------------ */

export interface Bridge {
  readonly isTauri: boolean;
  /** Documentos con los que se lanzó la aplicación (asociaciones de archivo). */
  startupFiles(): Promise<PickedFile[]>;
  /** Abre un diálogo de apertura y devuelve los archivos elegidos. */
  openFiles(filters: OpenFilter[]): Promise<PickedFile[]>;
  /** Abre una carpeta y lista su contenido (para el explorador Markdown). */
  openFolder(): Promise<{ root: string; entries: DirEntryInfo[] } | null>;
  readText(id: string): Promise<string>;
  readBytes(id: string): Promise<Uint8Array>;
  /** Escribe texto. `overwrite` debe venir de una confirmación explícita del usuario. */
  writeText(id: string, content: string, opts?: { overwrite?: boolean }): Promise<WriteResult>;
  /** Escribe bytes (PDF resultante, etc.). Misma política de sobrescritura. */
  writeBytes(id: string, content: Uint8Array, opts?: { overwrite?: boolean }): Promise<WriteResult>;
  /** Notas del usuario (almacén separado del documento original). */
  loadNotes(): Promise<string | null>;
  saveNotes(json: string): Promise<void>;
  /**
   * Estado por documento (posiciones de lectura y borradores de recuperación).
   * Mismo mecanismo que las notas: JSON local, nunca toca los documentos.
   */
  loadDocStore(): Promise<string | null>;
  saveDocStore(json: string): Promise<void>;
  /** Diálogo "Guardar como". No escribe nada: solo resuelve la ruta destino. */
  resolveSaveTarget(defaultName: string, filters: OpenFilter[]): Promise<PickedFile | null>;
  loadState(): Promise<string | null>;
  saveState(json: string): Promise<void>;
  /** Existencia del archivo (para confirmar sobrescrituras). */
  exists(id: string): Promise<boolean>;
  openWithSystem(id: string): Promise<boolean>;
  /** Indica si el identificador permite reabrir el documento al restaurar la sesión. */
  isRestorable(id: string): boolean;
  dirName(id: string): string;
  baseName(id: string): string;
}

/* ------------------------------------------------------------------ */
/* Implementación Tauri                                                */
/* ------------------------------------------------------------------ */

interface TauriInvoke {
  (cmd: string, args?: Record<string, unknown>): Promise<unknown>;
}

let tauriInvoke: TauriInvoke | null = null;

async function getInvoke(): Promise<TauriInvoke> {
  if (!tauriInvoke) {
    const mod = await import('@tauri-apps/api/core');
    tauriInvoke = mod.invoke as TauriInvoke;
  }
  return tauriInvoke;
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function filtersToTauri(filters: OpenFilter[]): { name: string; extensions: string[] }[] {
  return filters.map((f) => ({
    name: f.name,
    extensions: f.extensions.map((e) => e.replace(/^\./, '')),
  }));
}

const tauriBridge: Bridge = {
  isTauri: true,
  async startupFiles() {
    const invoke = await getInvoke();
    const paths = (await invoke('vela_startup_files')) as string[];
    return paths.map((p) => ({
      id: p,
      name: baseName(p),
      kind: kindFromName(p) ?? 'md',
    }));
  },
  async openFiles(filters) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const res = await open({ multiple: true, filters: filtersToTauri(filters) });
    const paths = res ? (Array.isArray(res) ? res : [res as string]) : [];
    return paths.map((p) => ({
      id: p,
      name: baseName(p),
      kind: kindFromName(p) ?? 'md',
    }));
  },
  async openFolder() {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const dir = await open({ directory: true, multiple: false });
    if (!dir || Array.isArray(dir)) return null;
    const invoke = await getInvoke();
    const entries = (await invoke('vela_read_dir', { path: dir })) as DirEntryInfo[];
    return { root: baseName(dir), entries };
  },
  async readText(id) {
    const invoke = await getInvoke();
    const b64 = (await invoke('vela_read_file', { path: id })) as string;
    return new TextDecoder().decode(b64ToBytes(b64));
  },
  async readBytes(id) {
    const invoke = await getInvoke();
    const b64 = (await invoke('vela_read_file', { path: id })) as string;
    return b64ToBytes(b64);
  },
  async writeText(id, content, opts) {
    const invoke = await getInvoke();
    return (await invoke('vela_write_file', {
      path: id,
      contentB64: bytesToB64(new TextEncoder().encode(content)),
      overwrite: opts?.overwrite ?? false,
    })) as WriteResult;
  },
  async writeBytes(id, content, opts) {
    const invoke = await getInvoke();
    return (await invoke('vela_write_file', {
      path: id,
      contentB64: bytesToB64(content),
      overwrite: opts?.overwrite ?? false,
    })) as WriteResult;
  },
  async loadNotes() {
    const invoke = await getInvoke();
    return (await invoke('vela_load_notes')) as string | null;
  },
  async saveNotes(json) {
    const invoke = await getInvoke();
    await invoke('vela_save_notes', { json });
  },
  async loadDocStore() {
    const invoke = await getInvoke();
    return (await invoke('vela_load_docstore')) as string | null;
  },
  async saveDocStore(json) {
    const invoke = await getInvoke();
    await invoke('vela_save_docstore', { json });
  },
  async resolveSaveTarget(defaultName, filters) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({ defaultPath: defaultName, filters: filtersToTauri(filters) });
    if (!path) return null;
    return { id: path, name: baseName(path), kind: kindFromName(path) ?? 'md' };
  },
  async loadState() {
    const invoke = await getInvoke();
    return (await invoke('vela_load_state')) as string | null;
  },
  async saveState(json) {
    const invoke = await getInvoke();
    await invoke('vela_save_state', { json });
  },
  async exists(id) {
    const invoke = await getInvoke();
    return (await invoke('vela_file_exists', { path: id })) as boolean;
  },
  async openWithSystem(id) {
    const invoke = await getInvoke();
    return (await invoke('vela_open_with_system', { path: id })) as boolean;
  },
  isRestorable(id) {
    return isAbsolutePath(id);
  },
  dirName,
  baseName,
};

/* ------------------------------------------------------------------ */
/* Implementación navegador                                            */
/* ------------------------------------------------------------------ */

type FileLike = FileSystemFileHandle | File;

const fileRegistry = new Map<string, FileLike>();
/** Archivos creados con «Guardar como»: no existían antes, no hay que confirmar. */
const createdFiles = new Set<string>();

/**
 * Identificador estable en navegador: nombre + tamaño + fecha. Sobrevive a
 * recargas (las notas y los recientes siguen apuntando al mismo documento).
 */
function fileKey(name: string, size: number, mtime: number): string {
  return `mem:${name}:${size}:${mtime}`;
}

function registerFile(f: File): PickedFile {
  const id = isTauri ? f.name : fileKey(f.name, f.size, f.lastModified);
  fileRegistry.set(id, f);
  return { id, name: f.name, kind: kindFromName(f.name) ?? 'md' };
}

async function registerHandle(h: FileSystemFileHandle): Promise<PickedFile> {
  if (isTauri) {
    fileRegistry.set(h.name, h);
    return { id: h.name, name: h.name, kind: kindFromName(h.name) ?? 'md' };
  }
  const file = await h.getFile();
  const id = fileKey(h.name, file.size, file.lastModified);
  fileRegistry.set(id, h);
  return { id, name: h.name, kind: kindFromName(h.name) ?? 'md' };
}

async function browserOpenFiles(filters: OpenFilter[]): Promise<PickedFile[]> {
  const w = window as unknown as {
    showOpenFilePicker?: (opts: unknown) => Promise<FileSystemFileHandle[]>;
  };
  const types = filters.map((f) => ({
    description: f.name,
    accept: {
      [f.name]: f.extensions.map((e) => (e.startsWith('.') ? e : `.${e}`)),
    },
  }));
  if (w.showOpenFilePicker) {
    try {
      const handles = await w.showOpenFilePicker({ multiple: true, types });
      const out: PickedFile[] = [];
      for (const h of handles) out.push(await registerHandle(h));
      return out;
    } catch (err) {
      const name = (err as Error)?.name;
      if (name === 'AbortError') return [];
      // SecurityError u otros: caemos al input clásico.
    }
  }
  return new Promise<PickedFile[]>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    const exts = filters.flatMap((f) => f.extensions.map((e) => (e.startsWith('.') ? e : `.${e}`)));
    input.accept = exts.join(',');
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', () => {
      const files = Array.from(input.files ?? []);
      input.remove();
      resolve(files.map(registerFile));
    });
    input.click();
  });
}

async function resolveFile(id: string): Promise<File> {
  const entry = fileRegistry.get(id);
  if (!entry) throw new Error(`Archivo no disponible: ${id}`);
  if ('getFile' in entry) return entry.getFile();
  return entry;
}

const browserBridge: Bridge = {
  isTauri: false,
  async startupFiles() {
    return [];
  },
  openFiles: browserOpenFiles,
  async openFolder() {
    const w = window as unknown as {
      showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
    };
    const mdFilter = (name: string) => /\.(md|markdown|mdown|pdf)$/i.test(name);
    if (w.showDirectoryPicker) {
      try {
        const root = await w.showDirectoryPicker();
        const entries: DirEntryInfo[] = [];
        const walk = async (dir: FileSystemDirectoryHandle, depth: number) => {
          for await (const [, handle] of (dir as unknown as {
            entries(): AsyncIterable<[string, FileSystemHandle]>;
          }).entries()) {
            if (handle.kind === 'directory') {
              if (depth < 2) await walk(handle as FileSystemDirectoryHandle, depth + 1);
            } else if (mdFilter(handle.name)) {
              const reg = await registerHandle(handle as FileSystemFileHandle);
              entries.push({ name: handle.name, id: reg.id, isDir: false, kind: reg.kind });
            }
          }
        };
        await walk(root, 0);
        entries.sort((a, b) => a.name.localeCompare(b.name, 'es'));
        return { root: root.name, entries };
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return null;
      }
    }
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      (input as unknown as { webkitdirectory: boolean }).webkitdirectory = true;
      input.style.display = 'none';
      document.body.appendChild(input);
      input.addEventListener('change', () => {
        const files = Array.from(input.files ?? []);
        input.remove();
        const entries = files
          .filter((f) => mdFilter(f.name))
          .map((f) => {
            const reg = registerFile(f);
            return { name: f.name, id: reg.id, isDir: false, kind: reg.kind };
          });
        entries.sort((a, b) => a.name.localeCompare(b.name, 'es'));
        resolve({ root: entries[0] ? dirName((entries[0] as { id: string }).id) : '', entries });
      });
      input.click();
    });
  },
  async readText(id) {
    return (await resolveFile(id)).text();
  },
  async readBytes(id) {
    return new Uint8Array(await (await resolveFile(id)).arrayBuffer());
  },
  async writeText(id, content, opts) {
    const overwrite = opts?.overwrite ?? false;
    const entry = fileRegistry.get(id);
    if (entry && 'createWritable' in entry) {
      // Guardado del propio archivo abierto: es la intención explícita del usuario.
      const w = await entry.createWritable();
      await w.write(content);
      await w.close();
      return 'ok';
    }
    const w = window as unknown as {
      showSaveFilePicker?: (opts: unknown) => Promise<FileSystemFileHandle>;
    };
    if (w.showSaveFilePicker) {
      const handle = await w.showSaveFilePicker({ suggestedName: baseName(id) });
      fileRegistry.set(id, handle);
      createdFiles.add(id);
      const out = await handle.createWritable();
      await out.write(content);
      await out.close();
      return 'ok';
    }
    if (!overwrite) return 'exists';
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = baseName(id);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return 'downloaded';
  },
  async writeBytes(id, content, opts) {
    const overwrite = opts?.overwrite ?? false;
    const entry = fileRegistry.get(id);
    if (entry && 'createWritable' in entry) {
      const w = await entry.createWritable();
      await w.write(content);
      await w.close();
      return 'ok';
    }
    const w = window as unknown as {
      showSaveFilePicker?: (opts: unknown) => Promise<FileSystemFileHandle>;
    };
    if (w.showSaveFilePicker) {
      const handle = await w.showSaveFilePicker({ suggestedName: baseName(id) });
      fileRegistry.set(id, handle);
      createdFiles.add(id);
      const out = await handle.createWritable();
      await out.write(content);
      await out.close();
      return 'ok';
    }
    if (!overwrite) return 'exists';
    const blob = new Blob([content.slice().buffer as ArrayBuffer], {
      type: 'application/octet-stream',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = baseName(id);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return 'downloaded';
  },
  async loadNotes() {
    try {
      return localStorage.getItem('vela.notes');
    } catch {
      return null;
    }
  },
  async saveNotes(json) {
    try {
      localStorage.setItem('vela.notes', json);
    } catch {
      /* cuota agotada: las notas siguen en memoria */
    }
  },
  async loadDocStore() {
    try {
      return localStorage.getItem('vela.docstore');
    } catch {
      return null;
    }
  },
  async saveDocStore(json) {
    try {
      localStorage.setItem('vela.docstore', json);
    } catch {
      /* cuota agotada: las posiciones y borradores siguen en memoria */
    }
  },
  async resolveSaveTarget(defaultName) {
    const w = window as unknown as {
      showSaveFilePicker?: (opts: unknown) => Promise<FileSystemFileHandle>;
    };
    if (w.showSaveFilePicker) {
      try {
        const handle = await w.showSaveFilePicker({ suggestedName: defaultName });
        const picked = await registerHandle(handle);
        createdFiles.add(picked.id);
        return picked;
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return null;
        return null;
      }
    }
    return null;
  },
  async loadState() {
    try {
      return localStorage.getItem('vela.state');
    } catch {
      return null;
    }
  },
  async saveState(json) {
    try {
      localStorage.setItem('vela.state', json);
    } catch {
      /* cuota agotada: se ignora, la sesión sigue en memoria */
    }
  },
  async exists(id) {
    // En navegador solo podemos afirmar existencia de los archivos ya abiertos.
    // Un destino creado con «Guardar como» no se considera preexistente: el
    // propio diálogo del navegador ya avisa si se reemplaza un archivo.
    return fileRegistry.has(id) && !createdFiles.has(id);
  },
  async openWithSystem() {
    return false;
  },
  isRestorable(id) {
    return isAbsolutePath(id);
  },
  dirName,
  baseName,
};

export const bridge: Bridge = isTauri ? tauriBridge : browserBridge;

/** Registra un archivo obtenido fuera del diálogo (arrastrar y soltar, pruebas). */
export function registerExternalFile(file: File): PickedFile {
  return registerFile(file);
}
