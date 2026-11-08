# Visit My London (`int-vml-core`)

Customer-facing web app for **Visit My London** — an independent London travel guide that also lets visitors discover and book tours, attractions, events, food, stays and more.

This repository is one Next.js application with a single PostgreSQL database accessed through Prisma. The public tourist site lives in the `app/(www)` route group; vendor and admin surfaces will be added as role-guarded route groups that share the same domain layer.

> **Status:** UI and foundations. The public pages (home, category, listing and event) are fully rendered from mock data, and the complete domain schema is migrated and seeded. Authentication, vendor/admin surfaces, Stripe checkout, live search/map, emails and jobs are **not wired up yet**. See [docs/WEBAPP_IMPLEMENTATION_PLAN.md](docs/WEBAPP_IMPLEMENTATION_PLAN.md) for the build order.

## Tech stack

| Area | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router, React Server Components, Turbopack) |
| UI | React 19.3, TypeScript (strict), Tailwind CSS v4, shadcn/ui (`base-nova`, built on `@base-ui/react`), `next-themes` |
| Type | Urbanist (display/headings) + Geist / Geist Mono (body) via `next/font` |
| Maps | `leaflet` + `react-leaflet` (OpenStreetMap tiles) |
| Data | PostgreSQL 15+, Prisma 6 (`prisma-client-js` + `prisma migrate`) |
| Auth | Better Auth — installed, **not configured yet** |
| Tooling | pnpm, ESLint (`eslint-config-next`), Prettier (`prettier-plugin-tailwindcss`) |

## Requirements

- **Node.js ≥ 20.9** (Next.js 16 engine requirement)
- **pnpm 10+**
- **PostgreSQL ≥ 15** — local Postgres or a hosted instance (the schema targets the Supabase pooled `DATABASE_URL` + direct `DIRECT_URL` pattern)

## Getting started

```bash
# 1. Install dependencies
pnpm install

# 2. Configure the environment
cp .env.example .env
# Edit .env and set both variables:
#   DATABASE_URL="postgresql://user:password@host:5432/mydb?pgbouncer=true"  # pooled, used at runtime
#   DIRECT_URL="postgresql://user:password@host:5432/mydb"                  # direct, used by migrations
```

> `.env.example` currently documents `DATABASE_URL` only. `DIRECT_URL` is also required — `prisma/schema.prisma` declares `directUrl = env("DIRECT_URL")` for migrations.

```bash
# 3. Generate the Prisma client and apply migrations
pnpm prisma:generate
pnpm prisma:migrate

# 4. (Optional) Create the seed vendor/listing/product/availability
pnpm db:seed

# 5. Start the dev server
pnpm dev
```

The app runs at <http://localhost:3000>.

### Prisma workflow

This repo uses **classic Prisma 6** with a checked-in schema and migrations:

```bash
pnpm prisma:generate        # regenerate the typed client after schema changes
pnpm prisma:migrate         # prisma migrate dev — create/apply a migration locally
pnpm prisma:studio          # browse the database
pnpm db:seed                # run prisma/seed.ts
```

- Schema: [`prisma/schema.prisma`](prisma/schema.prisma)
- Migrations: `prisma/migrations/`
- Seed: [`prisma/seed.ts`](prisma/seed.ts)
- **`prisma-8.md` is a stale template document** describing a different ORM. Ignore it; trust `schema.prisma` and `package.json`.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Pooled Postgres connection used by the running app. |
| `DIRECT_URL` | Yes | Direct/session connection used by `prisma migrate`. |
| `BETTER_AUTH_SECRET` | Later | Reserved for Better Auth; not read until auth is wired. |

`.env` files are gitignored. Storing secrets in them is fine for local development; production secrets belong in the deploy platform.

## Available scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Start the Next.js dev server. |
| `pnpm build` | Production build. |
| `pnpm start` | Serve the production build. |
| `pnpm lint` | Run ESLint. |
| `pnpm typecheck` | Run `tsc --noEmit`. |
| `pnpm format` | Format `.ts` / `.tsx` files with Prettier. |
| `pnpm prisma:generate` | Generate the Prisma client. |
| `pnpm prisma:migrate` | Create/apply a Prisma migration (dev). |
| `pnpm prisma:studio` | Open Prisma Studio. |
| `pnpm db:seed` | Seed the development database. |

## Routes

| Route | File | Description |
| --- | --- | --- |
| `/` | `app/page.tsx` | Home page: hero, category tiles, top attractions, areas, musicals, video band, newsletter. |
| `/[category]` | `app/(www)/[category]/page.tsx` | Category template, statically generated for every key in `CATEGORY_CONFIG`: `explore`, `attractions`, `tours`, `events`, `food-drink`, `nightlife`, `shopping`, `royal-london`, `arts-culture`, `music`, `stay`, `transport`. |
| `/listing/[slug]` | `app/(www)/listing/[slug]/page.tsx` | Listing detail: gallery, highlights, what's included, visitor guide, reviews, OSM map, sticky booking rail. |
| `/event/[slug]` | `app/(www)/event/[slug]/page.tsx` | Event detail: gallery, overview/location tabs, what's included, map. |

All of the above currently render **mock content** from [`lib/mock-data.ts`](lib/mock-data.ts) (listing/event detail copy is inline in their route files). Routes for auth, trips, bookings, vendor and admin are planned but do not exist yet.

## Project structure

```text
int-vml-core/
  app/
    (www)/                    # public tourist surface
      [category]/page.tsx     # category template (SSG from CATEGORY_CONFIG)
      event/[slug]/page.tsx   # event detail
      listing/[slug]/page.tsx # listing detail
    layout.tsx                # root layout: header, main, footer, fonts, theme
    page.tsx                  # home
    globals.css               # Tailwind v4 entry + vml-* brand tokens
  components/
    brand/                    # VML site components (header, footer, cards, widgets…)
    ui/                       # shadcn primitives (button, badge, input)
    theme-provider.tsx        # next-themes provider
  hooks/                      # (empty placeholder)
  lib/
    mock-data.ts              # UI-only fixture data
    prisma.ts                 # Prisma client singleton (hot-reload safe)
    utils.ts                  # re-exports cn() from the cn package
  prisma/
    schema.prisma             # full domain model
    migrations/               # SQL migrations
    seed.ts                   # dev seed
  public/                     # static assets (logo)
  docs/
    DESIGN_GUIDELINES.md      # visual language, tokens, component inventory
    WEBAPP_IMPLEMENTATION_PLAN.md # architecture, conventions, build sequence
  AGENTS.md                   # agent rules for this Next.js version
  CONTRIBUTING.md             # setup, commit and PR conventions
  CLAUDE.md                   # points Claude at AGENTS.md
```

## Data model

The MVP domain model is defined and migrated in [`prisma/schema.prisma`](prisma/schema.prisma):

- **Identity & supply:** `User`, `VendorMember`, `Vendor`, `Category`, `Listing`, `Product`, `Availability`
- **Booking & money:** `Booking`, `BookingItem`, `Payment`, `Transfer`, `Refund`, `Hold`, `WebhookEvent`
- **Planning & trust:** `Trip`, `TripItem`, `Review`

Key rules baked into the model:

- **Money is integer pence** (never floats), with an explicit `currency` on money-bearing rows.
- **Time is stored in UTC** and rendered in `Europe/London`.
- **Geo uses plain `lat`/`lng` + text `address`** for the current phase; PostGIS is deferred behind a documented seam.
- **Holds** model TTL inventory reservations, converted to permanent decrements on payment success.

## Conventions

The full conventions live in [docs/WEBAPP_IMPLEMENTATION_PLAN.md §2](docs/WEBAPP_IMPLEMENTATION_PLAN.md#2-conventions-the-rules-every-feature-follows). In short:

1. Domain logic lives in `lib/services/*`; components and server actions stay thin.
2. Every mutation boundary is validated with zod.
3. Authorization is server-side and explicit (`requireUser`, `requireRole`, `requireVendorMember`).
4. Money is integer pence; commission resolves vendor override → category default → platform default.
5. Times are stored UTC and rendered Europe/London.
6. Stripe writes are idempotent; webhooks are the source of truth.
7. Inventory changes are transactional (row locks around capacity checks).
8. External systems sit behind thin adapters (`lib/stripe`, `lib/email`, `lib/storage`).
9. Deferred work goes through pg-boss.
10. Commits are Conventional; `lint` + `typecheck` + `build` pass before every PR.

Before opening a PR, run:

```bash
pnpm lint
pnpm typecheck
pnpm build
```

Commit and PR conventions are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Documentation

| Document | Contents |
| --- | --- |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Setup, Conventional Commits, PR checklist. |
| [docs/WEBAPP_IMPLEMENTATION_PLAN.md](docs/WEBAPP_IMPLEMENTATION_PLAN.md) | Architecture, surfaces, conventions, build sequence, definition of done. |
| [docs/DESIGN_GUIDELINES.md](docs/DESIGN_GUIDELINES.md) | Brand foundations, layout system, component inventory, accessibility baseline. |
| [AGENTS.md](AGENTS.md) | Agent rules — notably that this Next.js version differs from older training data; read `node_modules/next/dist/docs/` before framework-level work. |

## What's next

The immediate roadmap (from the implementation plan):

1. Typed environment surface (`lib/env.ts`) and a complete `.env.example`.
2. Thin adapter skeletons for Stripe, email, storage and jobs.
3. Test harness (Vitest + Playwright) and GitHub Actions CI.
4. Better Auth wired, `User` model reconciled, RBAC guards.
5. Vendor onboarding, listings/availability, then the booking + payments loop.

## Notes

- No tests or CI pipeline are configured yet.
- The listing and event detail pages contain placeholder copy and Unsplash imagery for layout purposes only; replace before any public launch.
- Dark-mode tokens exist, but the marketing screens were designed light-first and have not had a dark-mode design review.
