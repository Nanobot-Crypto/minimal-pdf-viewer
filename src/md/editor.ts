/** Editor Markdown con CodeMirror 6: ligero, resaltado y sin servicios externos. */

import { Compartment, EditorState, type Extension } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  HighlightStyle,
  bracketMatching,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { search, searchKeymap, openSearchPanel } from '@codemirror/search';
import { tags } from '@lezer/highlight';

export interface MdEditorCallbacks {
  onDocChanged(text: string, cursor: number): void;
  onCursorChanged(cursor: number): void;
}

const lightHighlight = HighlightStyle.define([
  { tag: tags.heading1, color: '#1c1c1e', fontWeight: '700', fontSize: '1.35em' },
  { tag: tags.heading2, color: '#22242a', fontWeight: '700', fontSize: '1.2em' },
  {
    tag: [tags.heading3, tags.heading4, tags.heading5, tags.heading6],
    color: '#2b2d33',
    fontWeight: '600',
  },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.link, color: '#0b57d0' },
  { tag: tags.url, color: '#5f6368' },
  { tag: tags.monospace, color: '#0f6b45', fontFamily: 'var(--font-mono)' },
  { tag: tags.quote, color: '#6b6b70', fontStyle: 'italic' },
  { tag: tags.comment, color: '#8a8a90' },
  { tag: tags.meta, color: '#8a8a90' },
]);

const darkHighlight = HighlightStyle.define([
  { tag: tags.heading1, color: '#f2f2f5', fontWeight: '700', fontSize: '1.35em' },
  { tag: tags.heading2, color: '#e6e6ea', fontWeight: '700', fontSize: '1.2em' },
  {
    tag: [tags.heading3, tags.heading4, tags.heading5, tags.heading6],
    color: '#d6d6dc',
    fontWeight: '600',
  },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.link, color: '#8ab4ff' },
  { tag: tags.url, color: '#9a9aa2' },
  { tag: tags.monospace, color: '#7ee0b8', fontFamily: 'var(--font-mono)' },
  { tag: tags.quote, color: '#9a9aa2', fontStyle: 'italic' },
  { tag: tags.comment, color: '#7c7c85' },
  { tag: tags.meta, color: '#7c7c85' },
]);

const lightTheme = EditorView.theme({
  '&': { color: '#1c1c1e', backgroundColor: 'transparent', height: '100%', fontSize: '14px' },
  '.cm-content': {
    fontFamily: 'var(--font-mono)',
    padding: '18px 14px 60vh 14px',
    caretColor: '#1c1c1e',
  },
  '.cm-gutters': { backgroundColor: 'transparent', color: '#8f9098', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'rgba(11, 87, 208, 0.05)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'rgba(11, 87, 208, 0.18)',
  },
  '.cm-panels': { backgroundColor: '#f6f6f4', color: '#1c1c1e' },
  '.cm-panels input': {
    backgroundColor: '#fff',
    color: '#1c1c1e',
    border: '1px solid #d9d9d5',
    borderRadius: '4px',
    padding: '2px 6px',
  },
});

const darkTheme = EditorView.theme({
  '&': { color: '#e6e6ea', backgroundColor: 'transparent', height: '100%', fontSize: '14px' },
  '.cm-content': {
    fontFamily: 'var(--font-mono)',
    padding: '18px 14px 60vh 14px',
    caretColor: '#e6e6ea',
  },
  '.cm-gutters': { backgroundColor: 'transparent', color: '#71727c', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'rgba(138, 180, 255, 0.06)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'rgba(138, 180, 255, 0.22)',
  },
  '.cm-panels': { backgroundColor: '#22252b', color: '#e6e6ea' },
  '.cm-panels input': {
    backgroundColor: '#16181c',
    color: '#e6e6ea',
    border: '1px solid #2e3238',
    borderRadius: '4px',
    padding: '2px 6px',
  },
});

function themeExt(theme: 'light' | 'dark'): Extension {
  return theme === 'dark'
    ? [darkTheme, syntaxHighlighting(darkHighlight)]
    : [lightTheme, syntaxHighlighting(lightHighlight)];
}

export class MdEditor {
  private view: EditorView;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private themeCompartment = new Compartment();

  constructor(
    parent: HTMLElement,
    initialDoc: string,
    private cb: MdEditorCallbacks,
    theme: 'light' | 'dark',
    readOnly = false,
  ) {
    const extensions: Extension[] = [
      lineNumbers(),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      indentOnInput(),
      bracketMatching(),
      highlightActiveLine(),
      search({ top: true }),
      markdown({ base: markdownLanguage }),
      keymap.of([...searchKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
      EditorState.readOnly.of(readOnly),
      EditorView.lineWrapping,
      this.themeCompartment.of(themeExt(theme)),
      EditorView.updateListener.of((u) => {
        const cursor = u.state.selection.main.head;
        if (u.selectionSet) this.cb.onCursorChanged(cursor);
        if (u.docChanged) {
          this.cb.onCursorChanged(cursor);
          if (this.debounce) clearTimeout(this.debounce);
          this.debounce = setTimeout(() => {
            this.cb.onDocChanged(u.state.doc.toString(), cursor);
          }, 120);
        }
      }),
    ];
    this.view = new EditorView({
      state: EditorState.create({ doc: initialDoc, extensions }),
      parent,
    });
  }

  setTheme(theme: 'light' | 'dark'): void {
    this.view.dispatch({ effects: this.themeCompartment.reconfigure(themeExt(theme)) });
  }

  getText(): string {
    return this.view.state.doc.toString();
  }

  setText(text: string): void {
    this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: text } });
  }

  getCursor(): number {
    return this.view.state.selection.main.head;
  }

  setCursor(pos: number): void {
    const p = Math.min(Math.max(0, pos), this.view.state.doc.length);
    this.view.dispatch({ selection: { anchor: p }, scrollIntoView: true });
  }

  focus(): void {
    this.view.focus();
  }

  openSearch(): void {
    openSearchPanel(this.view);
  }

  destroy(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.view.destroy();
  }
}
