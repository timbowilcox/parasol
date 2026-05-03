# @parasol/web

Next.js 16 App Router. Customer-facing web app, mobile PWA, internal admin surfaces, API routes for inbound email and external integrations.

## Layout

```
src/
├── app/
│   ├── (marketing)/        # public routes (about, pricing, legal) — Sprint 7
│   ├── (auth)/             # login, signup, forgot password
│   ├── app/                # authenticated dashboard
│   │   ├── review/
│   │   ├── repository/     # Sprint 4
│   │   ├── playbooks/
│   │   ├── team/
│   │   ├── settings/
│   │   └── audit/          # Business tier; Sprint 5
│   ├── admin/              # parasol_admin only
│   │   ├── corpus/         # Sprint 1 (read-only + manual run)
│   │   ├── eval/           # Sprint 2
│   │   ├── observability/  # Sprint 7+
│   │   ├── workspaces/     # Sprint 5
│   │   ├── playbooks/
│   │   └── audit/
│   └── api/
│       ├── inbound/email/  # Resend inbound webhook
│       ├── reviews/        # review CRUD
│       ├── admin/          # admin-only endpoints
│       └── stripe/         # Sprint 3
├── components/             # shared UI components
├── lib/                    # client-side utilities
├── server/                 # server-only code (auth helpers, API utils)
└── styles/                 # global styles, tailwind config
```

## Conventions

- Server Components by default; `'use client'` only when interactivity required
- Server Actions for mutations; API routes for external integrations only
- Repository pattern: components → server actions → repositories (in `@parasol/core`) → Supabase
- No direct Supabase client calls from components
- Auth via `@supabase/ssr`; middleware enforces auth on `/app/*` and `/admin/*`
- Admin routes additionally check `parasol_admin` role; non-admins get 404 (intentionally undiscoverable)

## Local development

```bash
pnpm dev            # http://localhost:3000
pnpm test
pnpm typecheck
pnpm lint
```

## Database

Migrations in `supabase/migrations/`. Apply with `pnpm db:migrate`. Generate TypeScript types from schema with `pnpm db:types`.
