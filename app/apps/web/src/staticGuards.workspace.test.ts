// Feature: institutional-workspace — static architectural guard tests (web).
// Validates: Requirements 13.1, 14.5, 14.6
//
// These are pure static checks (no rendering): they read the web package manifest
// and the new workspace source files off disk and assert the steering-level
// architectural rules hold by construction —
//   • no third-party routing dependency is declared (Req 13.1),
//   • the Workspace_View surfaces navigate via URL hash fragments `#/workspaces`
//     and `#/workspaces/<id>` rather than a router API (Req 13.1),
//   • the muted-teal accent `#0d9488` is present on the new surfaces (Req 14.5),
//   • icons on the new surfaces are sourced from `lucide-react` (Req 14.6).
// They mirror the file-reading convention used by staticGuards.accounts.test.ts.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_PATH = resolve(HERE, '../package.json');
const APP_PATH = resolve(HERE, 'App.tsx');
const LIST_PATH = resolve(HERE, 'components/WorkspaceListView.tsx');
const DETAIL_PATH = resolve(HERE, 'components/WorkspaceDetailView.tsx');

const read = (p: string) => readFileSync(p, 'utf8');

describe('no third-party routing dependency (Req 13.1)', () => {
  // Known client-side routing packages. Hash routing in this app is hand-rolled in
  // App.tsx (window.location.hash + a hashchange listener), so none of these may be
  // declared in the web package — a router dependency would violate Req 13.1.
  const FORBIDDEN_ROUTERS = [
    'react-router',
    'react-router-dom',
    'wouter',
    '@tanstack/router',
    '@tanstack/react-router',
    '@reach/router',
    'navigo',
    'router5',
    'universal-router',
    'found',
    'react-easy-router',
    'crossroads',
    'director',
  ];

  const pkg = JSON.parse(read(PKG_PATH)) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
  const declared = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
  ]);

  it('declares none of the known router packages', () => {
    const found = FORBIDDEN_ROUTERS.filter((name) => declared.has(name));
    expect(found).toEqual([]);
  });

  it('declares no package whose name contains "router"', () => {
    const routerish = [...declared].filter((name) => /router/i.test(name));
    expect(routerish).toEqual([]);
  });
});

describe('workspace routes are hash-based #/workspaces and #/workspaces/:id (Req 13.1)', () => {
  const app = read(APP_PATH);

  it('routes the workspace list via the #/workspaces hash fragment', () => {
    expect(app).toMatch(/#\/workspaces/);
  });

  it('routes a single workspace via the #/workspaces/<id> hash fragment', () => {
    // The hand-rolled router matches `#/workspaces/<id>` to the detail view and
    // navigates to it by assigning the workspace id into the hash.
    expect(app).toMatch(/#\/workspaces\/\$\{encodeURIComponent\(workspaceId\)\}/);
    expect(app).toMatch(/\^#\\\/workspaces\\\/\(\[\^\/\?#\]\+\)/);
  });

  it('navigates by assigning window.location.hash, not a router API', () => {
    // The hand-rolled hash router sets window.location.hash and listens for
    // hashchange; both are present and no router import exists.
    expect(app).toMatch(/window\.location\.hash\s*=\s*'#\/workspaces'/);
    expect(app).toMatch(/addEventListener\('hashchange'/);
    expect(app).not.toMatch(/from\s+['"](react-router|wouter|@tanstack\/|@reach\/router)/);
  });
});

describe('muted-teal accent #0d9488 on the new surfaces (Req 14.5)', () => {
  for (const [label, path] of [
    ['WorkspaceListView.tsx', LIST_PATH],
    ['WorkspaceDetailView.tsx', DETAIL_PATH],
  ] as const) {
    it(`applies the #0d9488 accent on the ${label} surface`, () => {
      expect(read(path)).toMatch(/#0d9488/i);
    });
  }
});

describe('icons sourced from lucide-react on the new surfaces (Req 14.6)', () => {
  // Both workspace surfaces must import their icons from lucide-react and from no
  // other icon library.
  const OTHER_ICON_LIBS =
    /from\s+['"](react-icons|@heroicons\/|@mui\/icons|@fortawesome\/|feather-icons|@tabler\/icons|phosphor-react|@phosphor-icons\/)/;

  for (const [label, path] of [
    ['WorkspaceListView.tsx', LIST_PATH],
    ['WorkspaceDetailView.tsx', DETAIL_PATH],
  ] as const) {
    it(`${label} imports its icons from lucide-react and no other icon library`, () => {
      const src = read(path);
      expect(src).toMatch(/from\s+['"]lucide-react['"]/);
      expect(src).not.toMatch(OTHER_ICON_LIBS);
    });
  }
});
