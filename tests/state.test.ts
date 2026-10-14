/** Pruebas de persistencia: estado, recientes, favoritos y sesión. */

import { describe, expect, it } from 'vitest';
import {
  defaultState,
  parseState,
  pushRecent,
  serializeState,
  sessionToTabs,
  tabsToSession,
  toggleFavorite,
} from '../src/core/state';
import { createTab } from '../src/core/tabs';

describe('parseState / serializeState', () => {
  it('hace ida y vuelta sin pérdidas', () => {
    const s = defaultState();
    s.theme = 'dark';
    s.recents = pushRecent([], { id: '/docs/a.pdf', name: 'a.pdf', kind: 'pdf' });
    const round = parseState(serializeState(s));
    expect(round.theme).toBe('dark');
    expect(round.recents).toHaveLength(1);
  });

  it('tolera JSON corrupto o de otra versión', () => {
    expect(parseState('no es json').version).toBe(1);
    expect(parseState('{"version":99}').recents).toEqual([]);
    expect(parseState(null).theme).toBe('system');
  });

  it('limita los recientes a 12 y evita duplicados', () => {
    let recents: ReturnType<typeof defaultState>['recents'] = [];
    for (let i = 0; i < 15; i++) {
      recents = pushRecent(recents, { id: `f${i}.pdf`, name: `f${i}.pdf`, kind: 'pdf' });
    }
    recents = pushRecent(recents, { id: 'f14.pdf', name: 'f14.pdf', kind: 'pdf' });
    expect(recents).toHaveLength(12);
    expect(recents[0].id).toBe('f14.pdf');
    expect(recents.filter((r) => r.id === 'f14.pdf')).toHaveLength(1);
  });
});

describe('favoritos', () => {
  it('añade y quita marcadores de página', () => {
    const f1 = toggleFavorite([], { id: '/a.pdf', name: 'a.pdf', kind: 'pdf', page: 3 });
    expect(f1).toHaveLength(1);
    const f2 = toggleFavorite(f1, { id: '/a.pdf', name: 'a.pdf', kind: 'pdf', page: 3 });
    expect(f2).toHaveLength(0);
    const f3 = toggleFavorite(f1, { id: '/a.pdf', name: 'a.pdf', kind: 'pdf', page: 5 });
    expect(f3).toHaveLength(2);
  });
});

describe('sesión', () => {
  it('serializa pestañas con borradores y estado de vista', () => {
    const t1 = createTab({ fileId: '/a.pdf', name: 'a.pdf', kind: 'pdf', page: 4 });
    t1.zoom = 1.25;
    const t2 = createTab({ fileId: '/b.md', name: 'b.md', kind: 'md', draft: '# sin guardar' });
    t2.mdMode = 'preview';
    const session = tabsToSession([t1, t2]);
    expect(session[0].page).toBe(4);
    expect(session[0].zoom).toBe(1.25);
    expect(session[1].draft).toBe('# sin guardar');
    expect(session[1].mdMode).toBe('preview');

    const tabs = sessionToTabs(session);
    expect(tabs[0].page).toBe(4);
    expect(tabs[1].dirty).toBe(true);
    expect(tabs[1].mdMode).toBe('preview');
  });
});
