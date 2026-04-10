# Stowge UI (React)

React + TypeScript + Tailwind CSS front-end for the Stowge inventory app.

## Quick start

```bash
cd ui
npm install
npm run dev       # http://localhost:5173 (proxies /api to :18090)
```

Run the api first (`./scripts/run.sh --skip-ui-build`) so the Vite proxy has something to talk to.

## Build for production (outputs to dist/)

```bash
npm run build
```

The Vite config sets `outDir: "./dist"`, so the compiled bundle lands in `ui/dist/`.
The api serves this via the `UI_DIR` env var. `docker compose up --build` picks up the new UI automatically.

## Structure

```
src/
  config/
    nav.ts                  # Central nav config (icons, routes, groups)
  components/
    layout/
      AppShell.tsx          # Root shell: sidebar + topbar + scrollable content
      Sidebar.tsx           # Persistent desktop sidebar (expanded / icon-rail)
      MobileNavDrawer.tsx   # Slide-out drawer for mobile
      Topbar.tsx            # Top bar: hamburger, global search, user avatar
    command/
      CommandPalette.tsx    # Ctrl+K modal command palette
    ui/
      PageHeader.tsx        # Page title + action button row
      SearchInput.tsx       # Reusable search field
      DataTable.tsx         # Generic typed data table
  pages/
    PartsPage.tsx           # Parts list with search, filters, mock data
    PlaceholderPage.tsx     # Stub for routes not yet built
  App.tsx                   # BrowserRouter + routes + global Ctrl+K handler
  main.tsx
  index.css
```

## Key behaviours

| Breakpoint | Nav behaviour |
|---|---|
| `md` and up (≥768 px) | Persistent left sidebar, toggleable between full (240 px) and icon-rail (64 px) |
| below `md` | Sidebar hidden; hamburger in topbar opens slide-out drawer |

**Ctrl+K** opens the command palette from anywhere in the app.

## Tech stack

- [Vite](https://vitejs.dev/) 6
- [React](https://react.dev/) 18
- [TypeScript](https://www.typescriptlang.org/) 5
- [Tailwind CSS](https://tailwindcss.com/) 3
- [React Router](https://reactrouter.com/) 6
- [lucide-react](https://lucide.dev/) for icons
- [clsx](https://github.com/lukeed/clsx) for conditional class names
