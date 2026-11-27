# Visit My London (`int-vml-core`)

Customer-facing web app for **Visit My London** — an independent London travel guide that also lets visitors discover and book tours, attractions, events, food, stays and more.

This repository is one Next.js application with a single PostgreSQL database accessed through Prisma. The public tourist site lives in the `app/(www)` route group; vendor and admin surfaces will be added as role-guarded route groups that share the same domain layer.

> **Status:** UI and foundations. The public pages (home, category, listing and event) are fully rendered from mock data, and the complete domain schema is migrated and seeded. Durable jobs and transactional email (Brevo or a dev outbox) are wired, with typed environment validation and email templates. Authentication, vendor/admin surfaces, Stripe checkout and live search/map are **not wired up yet**. See [docs/WEBAPP_IMPLEMENTATION_PLAN.md](docs/WEBAPP_IMPLEMENTATION_PLAN.md) for the build order.

## Tech stack

| Area      | Choice                                                                                                              |
| --------- | ------------------------------------------------------------------------------------------------------------------- |
| Framework | Next.js 16 (App Router, React Server Components, Turbopack)                                                         |
| UI        | React 19.3, TypeScript (strict), Tailwind CSS v4, shadcn/ui (`base-nova`, built on `@base-ui/react`), `next-themes` |
| Type      | Urbanist (display/headings) + Geist / Geist Mono (body) via `next/font`                                             |
| Maps      | `leaflet` + `react-leaflet` (OpenStreetMap tiles)                                                                   |
| Data      | PostgreSQL 15+, Prisma 6 (`prisma-client-js` + `prisma migrate`)                                                    |
| Auth      | Better Auth — installed, **not configured yet**                                                                     |
| Tooling   | pnpm, ESLint (`eslint-config-next`), Prettier (`prettier-plugin-tailwindcss`)                                       |

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
# Edit .env and set the required variables:
#   DATABASE_URL="postgresql://user:password@host:5432/mydb?pgbouncer=true"  # pooled, used at runtime
#   DIRECT_URL="postgresql://user:password@host:5432/mydb"                  # direct, used by migrations
# Email and Better Auth values can stay blank until those features are needed.
```

```bash
# 3. Generate the Prisma client and apply migrations
pnpm prisma:generate
pnpm prisma:migrate

# 4. (Optional) Create the seed accounts, vendor, listing, product and a slot
pnpm db:seed

# 5. Start the dev server
pnpm dev
```

The app runs at <http://localhost:3000>.

### Local services (Postgres and image store)

`compose.yaml` runs Postgres 17 (Alpine) and Garage, a small S3-compatible
store for listing pictures, on `127.0.0.1` only.

```bash
docker compose up -d --build     # first start builds the images and sets up the bucket
docker compose logs garage-init  # shows "ready" when setup has finished
```

Use these values in `.env` (the development database is `vml_dev`; the test
database `vml_test` is created on first start):

```bash
DATABASE_URL="postgresql://vml:vml_local_password@localhost:5432/vml_dev"
DIRECT_URL="postgresql://vml:vml_local_password@localhost:5432/vml_dev"
TEST_DATABASE_URL="postgresql://vml:vml_local_password@localhost:5432/vml_test?sslmode=disable"
S3_ENDPOINT="http://localhost:3900"
S3_BUCKET="vml-images"
S3_REGION="garage"
S3_ACCESS_KEY_ID="GK0123456789abcdef01234567"
S3_SECRET_ACCESS_KEY="7a3c9e1f5b2d8a4c6e0f3b7d9a1c5e8f2b4d6a0c3e7f9b1d5a8c2e4f6b0d3a7c"
S3_PUBLIC_BASE_URL="http://localhost:3900/vml-images"
```

The compose file ships local-only defaults for passwords and keys. Change
them in a local `.env` used by compose, and never reuse them elsewhere.
`docker compose down` keeps the data; `docker compose down -v` deletes it.

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
- Seed: [`prisma/seed.ts`](prisma/seed.ts) (logic in [`prisma/seed-core.ts`](prisma/seed-core.ts))

### Seed accounts (development and test only)

`pnpm db:seed` is **idempotent** (run it as often as you like) and creates a vendor, a published listing with one product and a bookable slot, and four verified accounts:

| Email                   | Platform role | Vendor role (Seed Tours Co.) |
| ----------------------- | ------------- | ---------------------------- |
| `admin@seed.vml.test`   | `ADMIN`       | —                            |
| `owner@seed.vml.test`   | `VENDOR`      | `OWNER`                      |
| `staff@seed.vml.test`   | `VENDOR`      | `STAFF`                      |
| `tourist@seed.vml.test` | `TOURIST`     | —                            |

All four share one **publicly known** password, `Seed-password-1`; set `SEED_PASSWORD` to use another (re-running updates the stored hash). The `.test` domain is reserved, so these addresses can never belong to a real person.

> **Never seed a shared or production database.** These are privileged accounts with a published password. The seed command refuses to run when `NODE_ENV=production`, but that is a safety net, not a substitute for pointing `DATABASE_URL` at the right database. Re-running the seed also re-asserts the seeded roles and the vendor's `APPROVED` status.

- **`prisma-8.md` is a stale template document** describing a different ORM. Ignore it; trust `schema.prisma` and `package.json`.

## Environment variables

| Variable             | Required           | Purpose                                                                  |
| -------------------- | ------------------ | ------------------------------------------------------------------------ |
| `DATABASE_URL`       | Yes                | Pooled Postgres connection used by the running app.                      |
| `DIRECT_URL`         | Yes                | Direct/session connection used by `prisma migrate` and pg-boss.          |
| `JOBS_DATABASE_URL`  | No                 | Override for pg-boss; defaults to `DIRECT_URL`.                          |
| `BREVO_API_KEY`      | No                 | Enables Brevo delivery; requires `EMAIL_FROM`.                           |
| `EMAIL_FROM`         | With Brevo         | Verified sender address.                                                 |
| `EMAIL_FROM_NAME`    | No                 | Display name for the sender.                                             |
| `EMAIL_OUTBOX_DIR`   | No                 | Dev/test outbox; defaults to `.tmp/email-outbox`.                        |
| `BETTER_AUTH_SECRET` | Once auth is wired | Session signing secret; generate with `pnpm dlx auth@latest secret`.     |
| `BETTER_AUTH_URL`    | No                 | Public origin for cookies and email links; defaults to `localhost:3000`. |
| `TEST_DATABASE_URL`  | Integration tests  | Direct/session database whose name contains `test`.                      |

All of these are validated by [`lib/env.ts`](lib/env.ts). Blank optional values in `.env.example` are treated as unset, so copying the file does not fail validation.

`.env` files are gitignored. Storing secrets in them is fine for local development; production secrets belong in the deploy platform.

## Available scripts

| Command                | What it does                               |
| ---------------------- | ------------------------------------------ |
| `pnpm dev`             | Start the Next.js dev server.              |
| `pnpm build`           | Production build.                          |
| `pnpm start`           | Serve the production build.                |
| `pnpm lint`            | Run ESLint.                                |
| `pnpm typecheck`       | Run `tsc --noEmit`.                        |
| `pnpm format`          | Format `.ts` / `.tsx` files with Prettier. |
| `pnpm prisma:generate` | Generate the Prisma client.                |
| `pnpm prisma:migrate`  | Create/apply a Prisma migration (dev).     |
| `pnpm prisma:studio`   | Open Prisma Studio.                        |
| `pnpm db:seed`         | Seed the development database.             |

## Routes

| Route             | File                                | Description                                                                                                                                                                                                                   |
| ----------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`               | `app/page.tsx`                      | Home page: hero, category tiles, top attractions, areas, musicals, video band, newsletter.                                                                                                                                    |
| `/[category]`     | `app/(www)/[category]/page.tsx`     | Category template, statically generated for every key in `CATEGORY_CONFIG`: `explore`, `attractions`, `tours`, `events`, `food-drink`, `nightlife`, `shopping`, `royal-london`, `arts-culture`, `music`, `stay`, `transport`. |
| `/listing/[slug]` | `app/(www)/listing/[slug]/page.tsx` | Listing detail: gallery, highlights, what's included, visitor guide, reviews, OSM map, sticky booking rail.                                                                                                                   |
| `/event/[slug]`   | `app/(www)/event/[slug]/page.tsx`   | Event detail: gallery, overview/location tabs, what's included, map.                                                                                                                                                          |

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

Tests use Vitest: `pnpm test:unit` needs nothing external, `pnpm test:integration`
needs `TEST_DATABASE_URL` pointing at a **direct/session** Postgres whose
database name contains `test`.

Commit and PR conventions are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Background jobs

Background work runs on pg-boss, in a separate worker process:

```bash
pnpm worker        # consumes jobs; sends via Brevo when BREVO_API_KEY is set
pnpm jobs:plans    # prints the pg-boss schema SQL committed as a migration
```

The pg-boss schema lives in `prisma/migrations/*_pg_boss` and is applied by
`prisma migrate deploy`. Runtime instances run with `migrate: false`, so no DDL
happens at boot and the database role does not need `CREATE` privileges.

Email goes through the `EmailSender` contract (`lib/email/types.ts`). The worker
uses Brevo when `BREVO_API_KEY` and `EMAIL_FROM` are set; otherwise — in dev and
tests only — it appends messages to `EMAIL_OUTBOX_DIR/outbox.jsonl` so they can
be inspected without a provider account. Production fails fast if no transport
is configured rather than dropping mail silently.

Templates live in `lib/email/templates/*` and the auth email senders in
`lib/email/auth-senders.ts`. The worker validates the environment through
`lib/env.ts` before opening any connection.

## Documentation

| Document                                                                 | Contents                                                                                                                                           |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| [CONTRIBUTING.md](CONTRIBUTING.md)                                       | Setup, Conventional Commits, PR checklist.                                                                                                         |
| [docs/WEBAPP_IMPLEMENTATION_PLAN.md](docs/WEBAPP_IMPLEMENTATION_PLAN.md) | Architecture, surfaces, conventions, build sequence, definition of done.                                                                           |
| [docs/DESIGN_GUIDELINES.md](docs/DESIGN_GUIDELINES.md)                   | Brand foundations, layout system, component inventory, accessibility baseline.                                                                     |
| [AGENTS.md](AGENTS.md)                                                   | Agent rules — notably that this Next.js version differs from older training data; read `node_modules/next/dist/docs/` before framework-level work. |

## What's next

The immediate roadmap (from the implementation plan):

1. Better Auth wired against the Prisma identity tables, with sessions and RBAC guards.
2. Email verification flow and the register UI.
3. Vendor onboarding, listings/availability, then the booking + payments loop.
4. Stripe, storage and live search adapters.

## Notes

- The listing and event detail pages contain placeholder copy and Unsplash imagery for layout purposes only; replace before any public launch.
- Dark-mode tokens exist, but the marketing screens were designed light-first and have not had a dark-mode design review.
