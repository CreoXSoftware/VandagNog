# Task Planner

Collaborative project planner with hierarchical Epic → Task → Subtask, dependency-driven scheduling, live multi-user sync, and a custom-built Gantt view (no licensed dependencies).

See **[PRD.md](PRD.md)** for the full product spec.

## Stack

- **Frontend**: Vite + React 19 + TypeScript + Tailwind v4
- **Routing**: TanStack Router (code-based)
- **Data**: TanStack Query + Supabase JS client
- **State**: Zustand (where local UI state needed)
- **Gantt**: custom React + SVG component, ~400 LOC, no third-party Gantt library
- **Backend**: Supabase (Postgres, Auth magic-link, Realtime)

## Quick start

### 1. Set up Supabase

Follow every section of **[SUPABASE_SETUP.md](SUPABASE_SETUP.md)** end-to-end. It contains:

- Schema for all tables
- Triggers (hierarchy enforcement, parent rollup, audit log, notifications)
- The `reschedule_from` RPC for dependency-driven scheduling
- The `create_invite` and `accept_invite` RPCs
- Row-Level Security policies
- Realtime publication setup
- Optional `pg_cron` jobs

### 2. Configure environment

```pwsh
cd task-planner
Copy-Item .env.example .env
# Edit .env and fill in VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_APP_URL
```

### 3. Run

```pwsh
cd task-planner
npm install        # already done if you cloned with deps installed
npm run dev
```

Open <http://localhost:5173>. Sign in with magic link.

### 4. Build for production

```pwsh
npm run build
npm run preview
```

The static output is in `task-planner/dist` — deploy to Vercel, Netlify, Cloudflare Pages, or any static host.

## Project layout

```
TaskPlanner/
├── PRD.md                  # Product spec
├── SUPABASE_SETUP.md       # All backend SQL to run, step by step
├── README.md               # You are here
└── task-planner/           # Vite app
    ├── .env.example
    ├── src/
    │   ├── main.tsx
    │   ├── router.tsx
    │   ├── index.css
    │   ├── lib/            # env, supabase client, utils, time
    │   ├── types/          # TS types mirroring DB
    │   ├── hooks/          # React Query hooks + Realtime subscriptions
    │   ├── components/
    │   │   ├── ui/         # Button, Input, Drawer, Dialog, Select, Badge
    │   │   ├── layout/     # AppShell, Header, NotificationBell
    │   │   ├── workitem/   # WorkItemTree, WorkItemDrawer, DependencyEditor, CommentThread
    │   │   ├── gantt/      # GanttView (custom: timeline header, draggable bars, SVG dep arrows)
    │   │   └── members/    # MembersPanel + InviteDialog
    │   └── routes/         # login, projects (list), project (detail), invite, authCallback
```

## Feature checklist (MVP)

- [x] Magic-link auth
- [x] Project CRUD (soft delete via flag on `projects.deleted_at`)
- [x] Owner / Editor / Viewer roles enforced by RLS
- [x] Email-based project invites with magic-link sign-in
- [x] Epic / Task / Subtask hierarchy in one table, parent-id self-FK
- [x] Inline-edit detail drawer (right side, 480px overlay, URL `?item=<uuid>` for deep-link)
- [x] Single assignee per item, must be a project member
- [x] Leaf-only progress slider; parent dates + progress recomputed by Postgres trigger
- [x] Dependencies FS/FF/SS/SF + `lag_days`, any task↔task/subtask, no epics
- [x] Hybrid scheduling: optimistic client cache + `reschedule_from` RPC
- [x] Per-project weekends-only working calendar
- [x] Custom Gantt view with draggable bars, left/right resize handles, SVG dep arrows, weekend shading, today line
- [x] Tree + Gantt + Members view tabs in the project page
- [x] Comments — markdown, @mentions, 1-level reply, soft delete
- [x] In-app notifications: assigned, mentioned, comment-on-mine, invited, predecessor-moved, deleted
- [x] Realtime: one channel per project; per-user channel for notifications
- [x] Audit log of work_item / dependency / member changes
- [x] Soft delete + cascade (work_items)

## v2 / Roadmap (intentionally not built)

Email notifications, file attachments, multi-assignee, holiday calendars, status enum, undo stack, project-wide activity feed, exports, mobile UI, critical-path highlighting, SSO/SAML. See [PRD.md](PRD.md) §20.

## Troubleshooting

- **"Missing env var: VITE_SUPABASE_URL"** → copy `.env.example` → `.env` and fill in values.
- **Magic-link email never arrives** → check Supabase Auth → Settings → SMTP settings; Supabase has a low-rate default. Add your own SMTP provider for production volumes.
- **"new row violates row-level security policy"** → you forgot to run a SQL block in `SUPABASE_SETUP.md`. Re-run sections 7 and 8 to install the view + policies.
- **Realtime not updating** → confirm section 9 was run; verify the publication contains all 6 tables: `select * from pg_publication_tables where pubname='supabase_realtime';`
