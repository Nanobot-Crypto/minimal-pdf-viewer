/** Iconografía discreta: trazo 1.5, 16×16, estilo neutro. */

const S = 'xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"';

export const icons = {
  open: `<svg ${S}><path d="M2 4.5h4l1.2 1.5H14v7.5H2z"/><path d="M2 4.5V3h4l1.2 1.5"/></svg>`,
  sidebar: `<svg ${S}><rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M6 2.5v11"/></svg>`,
  palette: `<svg ${S}><circle cx="8" cy="8" r="5.5"/><path d="M8 5.5v5M5.5 8h5"/></svg>`,
  sun: `<svg ${S}><circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1"/></svg>`,
  moon: `<svg ${S}><path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z"/></svg>`,
  close: `<svg ${S}><path d="M4 4l8 8M12 4l-8 8"/></svg>`,
  pdf: `<svg ${S}><path d="M4 2h5l3 3v9H4z"/><path d="M9 2v3h3"/><path d="M6 9h4M6 11h3"/></svg>`,
  md: `<svg ${S}><path d="M4 2h5l3 3v9H4z"/><path d="M9 2v3h3"/><path d="M5.8 11v-3l1.4 1.6L8.6 8v3M10.6 8v3M9.7 10.3l.9 1 .9-1"/></svg>`,
  search: `<svg ${S}><circle cx="7" cy="7" r="4"/><path d="M10 10l3.5 3.5"/></svg>`,
  zoomIn: `<svg ${S}><circle cx="7" cy="7" r="4"/><path d="M10 10l3.5 3.5M5 7h4M7 5v4"/></svg>`,
  zoomOut: `<svg ${S}><circle cx="7" cy="7" r="4"/><path d="M10 10l3.5 3.5M5 7h4"/></svg>`,
  fitWidth: `<svg ${S}><rect x="2" y="4" width="12" height="8" rx="1"/><path d="M4.5 8h7M6 6.5L4.5 8 6 9.5M10 6.5L11.5 8 10 9.5"/></svg>`,
  fitPage: `<svg ${S}><rect x="3.5" y="2.5" width="9" height="11" rx="1"/><path d="M6 8h4M7 6.5L5.5 8 7 9.5"/></svg>`,
  rotate: `<svg ${S}><path d="M13 8a5 5 0 1 1-1.7-3.8"/><path d="M13 2.5V5h-2.5"/></svg>`,
  print: `<svg ${S}><path d="M4.5 6V2.5h7V6"/><rect x="2.5" y="6" width="11" height="4.5" rx="1"/><rect x="4.5" y="9.5" width="7" height="4"/></svg>`,
  star: `<svg ${S}><path d="M8 2.2l1.7 3.5 3.8.5-2.8 2.7.7 3.8L8 10.9l-3.4 1.8.7-3.8L2.5 6.2l3.8-.5z"/></svg>`,
  bookmark: `<svg ${S}><path d="M4 2.5h8v11l-4-2.6-4 2.6z"/></svg>`,
  thumbs: `<svg ${S}><rect x="2" y="2.5" width="5" height="6" rx="1"/><rect x="9" y="2.5" width="5" height="6" rx="1"/><rect x="2" y="10.5" width="5" height="3" rx="1"/><rect x="9" y="10.5" width="5" height="3" rx="1"/></svg>`,
  list: `<svg ${S}><path d="M5 4h9M5 8h9M5 12h9M2.5 4h.01M2.5 8h.01M2.5 12h.01"/></svg>`,
  folder: `<svg ${S}><path d="M2 4h4l1.2 1.5H14V12H2z"/></svg>`,
  file: `<svg ${S}><path d="M4 2h5l3 3v9H4z"/><path d="M9 2v3h3"/></svg>`,
  save: `<svg ${S}><path d="M3 3h8l2 2v8H3z"/><path d="M5 3v3.5h5V3M5 13v-3.5h6V13"/></svg>`,
  warning: `<svg ${S}><path d="M8 2.5L14 13H2z"/><path d="M8 6.5v3M8 11h.01"/></svg>`,
  refresh: `<svg ${S}><path d="M13 8a5 5 0 1 1-1.5-3.6"/><path d="M13 2.5v3h-3"/></svg>`,
  back: `<svg ${S}><path d="M10 3L5 8l5 5"/></svg>`,
  fwd: `<svg ${S}><path d="M6 3l5 5-5 5"/></svg>`,
  split: `<svg ${S}><rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M8 2.5v11"/></svg>`,
  eye: `<svg ${S}><path d="M1.8 8S4 4 8 4s6.2 4 6.2 4-2.2 4-6.2 4S1.8 8 1.8 8z"/><circle cx="8" cy="8" r="1.8"/></svg>`,
  edit: `<svg ${S}><path d="M11.2 2.8l2 2L6 12H4v-2z"/><path d="M9.5 4.5l2 2"/></svg>`,
  more: `<svg ${S}><circle cx="3.5" cy="8" r=".9" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r=".9" fill="currentColor" stroke="none"/><circle cx="12.5" cy="8" r=".9" fill="currentColor" stroke="none"/></svg>`,
  lock: `<svg ${S}><rect x="3.5" y="7" width="9" height="6.5" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>`,
  export: `<svg ${S}><path d="M8 10V2.5M5.5 5L8 2.5 10.5 5"/><path d="M3 9.5v3h10v-3"/></svg>`,
  // Controles de ventana (estilo GNOME/Adwaita).
  winMin: `<svg ${S}><path d="M4 8h8"/></svg>`,
  winMax: `<svg ${S}><rect x="4" y="4" width="8" height="8" rx="1"/></svg>`,
  winRestore: `<svg ${S}><rect x="3.5" y="5.5" width="7" height="7" rx="1"/><path d="M6 5.5V4.5a1 1 0 0 1 1-1h4.5a1 1 0 0 1 1 1V9a1 1 0 0 1-1 1h-1"/></svg>`,
  winClose: `<svg ${S}><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>`,
};

export function icon(name: keyof typeof icons): SVGElement {
  const wrap = document.createElement('span');
  wrap.className = 'icon';
  wrap.innerHTML = icons[name];
  return wrap.firstElementChild as SVGElement;
}
