# VisitMyLondon — Web App Implementation Plan

*The build plan for the application itself: how the Next.js 16 app is structured, the conventions every feature follows, and the exact sequence of work that turns the current scaffold into the Tours + Events MVP. Sits under the MVP Implementation Plan (which owns scope, data model, and milestones) and translates it into a codebase.*

**Status:** Build-ready · **Target:** Tours + Events MVP on live Stripe · **Repo:** `int-vml-core`

---

## 0. How to read this

| If you want… | Go to |
|---|---|
| What already exists in the repo | §1 Current state |
| The rules every piece of code follows | §2 Conventions |
| How the app is laid out on disk | §3 Project structure |
| How routing / the three surfaces work | §4 Surfaces & routing |
| How a feature is built (the vertical-slice recipe) | §5 Feature anatomy |
| The exact order to build in | §6 Build sequence |
| What each slice must satisfy to be "done" | §6 (per-slice AC) + §7 DoD |

This plan does not restate the domain model, the use cases, or the milestone exit gates — those live in the MVP Implementation Plan and remain authoritative. Where this plan adds detail (routing, service-layer shape, server-action patterns), it is the execution source for the app code.

---

## 1. Current state of the repo

The scaffold is further along than a blank Next app. What's present and working:

- **Next.js 16** (App Router, RSC, Turbopack), **React 19.3**, **TypeScript strict**, **pnpm**.
- **Tailwind v4** + **shadcn/ui** (`components.json`, `button` added, `theme-provider` + `next-themes` dark mode).
- **Classic Prisma 6** (`prisma-client-js` generator + `prisma migrate`) — *not* the Prisma-8 "contract" ORM that `prisma-8.md` describes. That doc is stale template boilerplate; ignore it. The real workflow is `schema.prisma` + `prisma migrate dev`.
- **Full MVP data model already defined and migrated** (`20261108044754_init`): User, VendorMember, Vendor, Category, Listing, Product, Availability, Booking, BookingItem, Payment, Transfer, Refund, Hold, WebhookEvent, Trip, TripItem, Review — with all enums, indexes, and money-as-pence integers. This matches §8 of the MVP Implementation Plan.
- **Geo decision already taken in code:** plain `lat`/`lng` floats + text `address` for the Supabase dev phase; PostGIS deferred to a later generated column (documented at the top of `schema.prisma`). Discovery map and radius search must be written against lat/lng for now.
- **DB wiring:** `datasource` uses pooled `DATABASE_URL` (runtime) + `DIRECT_URL` (migrations) — the Supabase pooler pattern. `lib/prisma.ts` has the hot-reload singleton.
- **Seed:** one Tours category, one approved vendor, one published listing, one product, one future availability slot. Enough to exercise a booking.
- **Repo hygiene:** Conventional Commits + PR checklist (`CONTRIBUTING.md`); `pnpm lint`/`typecheck`/`build` are the gate; Prettier + ESLint (next config). `AGENTS.md` warns that this Next version has breaking changes — **read `node_modules/next/dist/docs/` before writing framework code.**

What's **not** there yet (the entire application layer):

- Better Auth is a dependency but **not configured** — no auth client, no server instance, no Session/Account/Verification tables wired, no route protection. `User` is modelled in Prisma but Better Auth's tables aren't generated yet; these must be reconciled (see §6, Slice 1).
- No `.env` for Stripe, Resend, S3, Better Auth secret (only `DATABASE_URL` in `.env.example`).
- No service/domain layer, no server actions, no zod schemas, no validation helpers.
- No surfaces beyond the template `app/page.tsx` — no `www`/`vendor`/`admin` split, no route groups.
- No Stripe / Resend / S3 adapters, no pg-boss worker.
- No tests (Vitest/Playwright not installed), no CI workflow.
- `.env.example` still shows the generic placeholder DB URL, not the real variable set.

**Implication for sequencing:** M0 is *partly* done (framework, schema, seed). The immediate work is to finish M0's foundations — env surface, auth, adapters, the service-layer skeleton, test harness, CI — *before* building features on top. §6 starts exactly there.

---

## 2. Conventions (the rules every feature follows)

These make a solo codebase stay coherent. They are not negotiable per-feature; change them here, once, if they're wrong.

**1. The service layer is the only place domain logic lives.** React components (server or client) and server actions are thin. They validate input, call a service, and shape the response. Authorization, money math, inventory decrements, Stripe calls, and state transitions happen in `lib/services/*`, never in a component and never in a route handler. This is the seam that lets the heavy parts be tested and later extracted.

**2. Every mutation boundary is zod-validated.** Server actions and route handlers parse their input with a zod schema before doing anything. Schemas are shared with the client forms (react-hook-form + `@hookform/resolvers/zod`) so validation is written once. Invalid input never reaches a service.

**3. Authorization is server-side and explicit.** A central guard (`requireUser`, `requireRole`, `requireVendorMember`) runs inside the service or at the top of the action. UI hiding is a convenience, never a control. Each surface also has route-level protection (§4).

**4. Money is integer pence, always.** No floats touch an amount. A tiny `Money` helper formats for display (pence → "£25.00"). Commission resolves in the fixed order: vendor override → category default → platform default, and is computed in a service, never in the UI.

**5. Time is stored UTC, rendered Europe/London.** `date-fns` + tz. Availability correctness across BST/GMT depends on this; never store local time.

**6. Stripe writes are idempotent; webhooks are the source of truth.** Every Stripe-mutating call carries an idempotency key. Booking/payment/transfer/refund state is set by the webhook handler (deduped via `WebhookEvent.stripeEventId`), not by the browser redirect. The redirect shows an optimistic "processing" state.

**7. Inventory changes are transactional.** Hold creation, hold→permanent conversion, and refund restock each run in a single DB transaction with the capacity check inside it (advisory lock or `SELECT … FOR UPDATE` on the availability row). Two concurrent bookings of the last seat → exactly one wins.

**8. External systems live behind thin adapters.** `lib/stripe/`, `lib/email/`, `lib/storage/` wrap Stripe/Resend/S3. Services depend on the adapter interface, so tests mock the adapter, not the SDK.

**9. Async work goes through pg-boss.** Emails, hold expiry, abandoned-booking cleanup, payout/transfer reconciliation. Handlers are wrapped in Sentry. No work that can be deferred blocks a request.

**10. Commits are Conventional; `lint`+`typecheck`+`build` must pass before every PR.** Vertical slices ship as focused PRs. Follow `CONTRIBUTING.md`.

---

## 3. Project structure

One Next.js app, three surfaces as route groups sharing one domain layer. Target layout (built incrementally — don't create empty folders ahead of need):

```
int-vml-core/
  app/
    (www)/                 # public tourist site — SSR/ISR, SEO
      layout.tsx
      page.tsx             # home
      listings/
        page.tsx           # search + filters + map results
        [slug]/page.tsx    # listing detail + booking widget
      trips/…              # wishlist + itinerary
      bookings/…           # "my bookings"
      (auth)/              # register, sign-in, verify, reset
    vendor/                # vendor. surface — RBAC: VENDOR
      layout.tsx           # guards VENDOR role
      onboarding/…         # application + Stripe Connect
      listings/…           # listing + product + availability mgmt
      bookings/…           # fulfil / no-show
      payouts/…
    admin/                 # admin. surface — RBAC: ADMIN
      layout.tsx           # guards ADMIN role
      vendors/…            # approval queue
      listings/…           # moderation queue
      categories/…
      bookings/…           # oversight + refunds
    api/
      auth/[...all]/route.ts   # Better Auth handler
      webhooks/stripe/route.ts # Stripe webhook (signature-verified, idempotent)
  lib/
    prisma.ts              # (exists)
    auth.ts                # Better Auth server instance
    auth-client.ts         # Better Auth React client
    authz.ts               # requireUser / requireRole / requireVendorMember
    money.ts               # pence helpers + commission resolution
    time.ts                # UTC store / London render
    services/
      listing.ts  availability.ts  booking.ts  payment.ts
      payout.ts   moderation.ts     search.ts    trip.ts  review.ts
    availability/
      module.ts            # AvailabilityModule interface
      timed-slot.ts        # the one module that ships for MVP
    stripe/                # adapter: accounts, checkout, transfers, refunds, webhooks
    email/                 # Resend adapter + templates
    storage/               # S3 adapter (env-switched endpoint)
    jobs/                  # pg-boss setup + handlers
    validation/            # zod schemas shared client+server
  prisma/
    schema.prisma          # (exists) + Better Auth models reconciled
    seed.ts                # (exists)
  tests/                   # Vitest (unit/integration) + Playwright (e2e)
  components/ui/           # shadcn (exists: button, theme-provider)
```

Subdomains (`vendor.` / `admin.`) can be mapped at the proxy/Coolify layer later; in the codebase they are route segments with role-guarded layouts, which is enough for the MVP and keeps one dev server.

---

## 4. Surfaces & routing

**`(www)` — public, SSR/ISR.** Open to guests. Server-rendered for SEO: clean slugs, metadata, `sitemap.xml`, robots, schema.org (`Event`, `Product`/`Offer`, `LocalBusiness`). Listing and detail pages use ISR (revalidate on content change) and keep availability live (fetched fresh, not cached). Booking widgets are client components inside server pages.

**`vendor/` — RBAC VENDOR.** The segment layout calls the authz guard; a non-vendor is redirected to sign-in or a "become a vendor" page. All data access is scoped to the caller's vendor(s) via `VendorMember` in the service, never by trusting a `vendorId` from the client.

**`admin/` — RBAC ADMIN.** Same pattern, ADMIN role. Queues (vendor approval, listing moderation), oversight views, refunds, category CRUD.

**API routes.** Only two, both infrastructure: the Better Auth catch-all (`api/auth/[...all]`) and the Stripe webhook. First-party UI uses **server actions**, not a REST layer — no API drift, end-to-end types.

**Guard pattern (illustrative):**
```ts
// vendor/layout.tsx
const { user } = await requireRole('VENDOR')   // redirects if not
// services then re-check: requireVendorMember(user, vendorId)
```
Route-level guard is the coarse gate; the service-level check is the real one.

---

## 5. Feature anatomy (the vertical-slice recipe)

Every feature is built as one vertical slice, in this order, so each PR is shippable and testable:

1. **Schema** — already migrated for the MVP; add only if the slice needs a new field/table (migration via `prisma migrate dev`).
2. **Zod schema** in `lib/validation/` — the input contract, shared client + server.
3. **Service** in `lib/services/` — the logic: authz check, validation assumptions, DB work in a transaction where state/money/inventory changes, adapter calls. Pure enough to unit-test.
4. **Server action** (or webhook/route handler) — parse input with the zod schema, call the service, return a typed result. Thin.
5. **UI** — server component for data/SEO; client component (react-hook-form) for the interactive bit. shadcn/ui components.
6. **Tests** — unit for money/policy/availability logic; integration (real Postgres) for transactions and state transitions; e2e (Playwright) for the few critical user journeys.
7. **Pass the gate** — `lint`, `typecheck`, `build`; Conventional-Commit PR.

The money-touching slices (availability, checkout, webhooks, refunds) get the integration and Stripe-CLI tests described in §6; the lighter slices (trips, reviews) get unit + a smoke e2e.

---

## 6. Build sequence

Ordered for earliest proof of the booking loop, mapped to the MVP milestones (M0–M6) and epics (EPIC-0…13). Each slice names its deliverables and its acceptance criterion. Build top to bottom; §6.3 onward can overlap only where noted.

### 6.0 — Finish foundations (M0 · EPIC-0)

The framework, schema, and seed exist; finish the rest of M0.

- **Slice 0a — Env & secrets surface.** Expand `.env.example` to the full set: `DATABASE_URL`, `DIRECT_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_*`, `RESEND_API_KEY`, `EMAIL_FROM`, S3 (`S3_ENDPOINT`/`S3_REGION`/`S3_BUCKET`/`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`), `APP_URL`. A typed `lib/env.ts` (zod-parsed `process.env`) that fails fast on boot. *AC: app refuses to start with a missing required var, with a clear message.*
- **Slice 0b — Adapters as stubs behind interfaces.** `lib/stripe/`, `lib/email/`, `lib/storage/`, `lib/jobs/` — real clients wired, thin interfaces defined, so later slices import a stable surface. pg-boss connects and a no-op job proves the queue. *AC: a no-op job enqueues and runs; Stripe/Resend/S3 clients construct from env.*
- **Slice 0c — Test harness + CI.** Install Vitest (+ a disposable Postgres for integration), Playwright, Stripe CLI usage documented. GitHub Actions: `lint` → `typecheck` → `test` → `build`; Coolify deploys on merge to `main`. *AC: a trivial unit test and a trivial Playwright test run in CI; `main` stays releasable.*
- **Slice 0d — Sentry + PostHog + structured logging.** Init both (free tiers), wrap pg-boss handlers in Sentry. *AC: a thrown error in a job surfaces in Sentry.*

**M0 exit gate (unchanged):** the seeded listing is bookable & payable in **test** mode with the fee split visible — reached at the end of §6.3 for the happy path; 0a–0d are the platform it stands on.

### 6.1 — Identity, Auth & RBAC (M0→M1 · EPIC-1)

- **Slice 1 — Better Auth wired.** Configure the Better Auth server instance (`lib/auth.ts`) and React client (`lib/auth-client.ts`) on the existing Postgres via the Prisma adapter. **Reconcile the hand-written `User` model with Better Auth's generated tables** — decide whether Better Auth owns `User` (likely) and align field names (`emailVerified`, `name`, `image`) and the `platformRole` extension; generate Session/Account/Verification; migrate. Email/password, email verification, password reset, session rotation. Auth emails via the Resend adapter. Rate-limit auth endpoints (Postgres-backed token bucket — no Redis). *AC: UC-01/02/03 pass; verification + reset round-trip works.*
- **Slice 2 — RBAC guard + route protection.** `lib/authz.ts`: `requireUser`, `requireRole`, `requireVendorMember`. Role-guarded layouts for `vendor/` and `admin/`. *AC: unauthenticated/misrole access is blocked server-side, not just hidden.*

### 6.2 — Vendor supply (M1 · EPIC-2,3,4,5-core)

- **Slice 3 — Vendor application + admin approval.** Application form → `Vendor(PENDING)` + `VendorMember(OWNER)`. Admin approval queue (approve/reject/suspend) — this is the EPIC-5 core needed now. *AC: UC-14 (apply part) + UC-20 pass.*
- **Slice 4 — Stripe Connect Express onboarding.** Create connected account, hosted onboarding link, `account.updated` webhook → `stripeOnboardingComplete` when charges+payouts enabled. Hard server-side gate: no publish, no payout until `APPROVED && stripeOnboardingComplete`. *AC: a test vendor reaches payout-ready; gates hold.*
- **Slice 5 — Listing & product CRUD + images.** Listing CRUD (title/slug/description/category/address/lat-lng), S3 image upload (optimized, multiple), product CRUD (price pence, policy JSON), submit-for-review → `PENDING_REVIEW`; admin moderation queue → `PUBLISHED`. *AC: UC-15 + UC-21 pass; listing lifecycle matches the state machine.*
- **Slice 6 — Timed-slot availability module.** `AvailabilityModule` interface + `timed-slot.ts`: single slots + recurrence (capacity, times). Edit/close future slots; protect slots with bookings. **`Hold` with TTL + pg-boss expiry; transactional decrement with row lock.** *AC: UC-16 passes; two concurrent bookings on the last unit → exactly one succeeds (integration test).*

**M1 exit gate:** a real vendor onboards, passes KYC, and publishes a bookable listing.

### 6.3 — Booking + payments (M3-first, overlaps M2 · EPIC-7,8,9)

Pulled early because it closes the M0 "payable in test mode" gate and proves the model. Can start once Slice 6 lands; discovery (§6.4) can overlap.

- **Slice 7 — Cart + holds.** Add product+slot+qty to cart; soft hold (transactional capacity check + `Hold` row + scheduled expiry); per-vendor grouping; commission computed per item (D5 order). *AC: UC-10 passes; holds expire and release inventory.*
- **Slice 8 — Checkout + Stripe.** Re-validate holds at checkout; create `Booking(PENDING)` + `BookingItem`s; Stripe Checkout with idempotency key — **single-vendor:** destination charge + `application_fee_amount`; **multi-vendor:** platform PaymentIntent + separate transfers on confirm. No card data touches VML. *AC: UC-11 single- and multi-vendor payments complete in test mode; fee split visible in Stripe → closes M0 gate; multi-vendor closes the M3 proof.*
- **Slice 9 — Webhooks + booking lifecycle.** Signature-verified, `WebhookEvent`-deduped handler. `payment_intent.succeeded` → `Payment=succeeded`, `Booking=CONFIRMED`, holds→permanent decrement (TX), create `Transfer` rows + Stripe transfers, enqueue emails. PENDING-TTL cleanup job. "My bookings" view; cancel-within-policy. *AC: delayed/duplicate webhooks handled idempotently; no double-processing; UC-12 passes.*
- **Slice 10 — Transactional email.** Resend templates: booking confirmation, vendor new-booking, refund, auth. pg-boss send jobs with retry/backoff, outage-tolerant. *AC: each state transition that needs an email sends exactly one.*

**M3 exit gate:** a live multi-vendor booking completes; both vendors paid (reached on live Stripe at M6 cutover; proven in test mode here).

### 6.4 — Discovery (M2 · EPIC-6) — overlaps §6.3

- **Slice 11 — Public pages + search + map + SEO.** Category/listing/detail pages (SSR/ISR); Postgres FTS search + filters (category/area/date/price); map view of results over lat/lng (tile layer; radius via haversine or a bounding-box query while PostGIS is deferred); SEO (slugs, metadata, sitemap, robots, schema.org). *AC: UC-07/08/09 pass; detail pages validate in a structured-data tester; pages indexable.*

### 6.5 — Admin governance (M4 · EPIC-5-rest,10)

- **Slice 12 — Refunds + transfer reversal.** Admin full/partial refund + transfer reversal; refund/reversal webhooks → `Refund` rows + status + inventory return; partial refund recomputes commission proportionally. *AC: UC-24 passes; ledger reconciles to Stripe.*
- **Slice 13 — Oversight, reconciliation, categories, disputes.** Booking/payment/transfer oversight views + basic metrics (GMV, fees); payout/transfer reconciliation job (retry failed transfers, flag to admin); category/taxonomy CRUD (type + commission default); dispute surface. *AC: UC-22/23/25/26 pass.*

**M4 exit gate:** admin runs the platform end to end incl. refund + reversal.

### 6.6 — Trip planning + reviews (M5 · EPIC-11,12)

- **Slice 14 — Trips.** Save listing/product to a `Trip`; simple ordered itinerary with optional planned dates; book from a trip. *AC: UC-30/31 pass.*
- **Slice 15 — Reviews.** Post-completed-booking review (star + text) gated to a `BookingItem`; admin moderation; display on listing. *AC: only verified purchasers can review; moderation works.*

These are the safest to defer if bandwidth tightens — they don't block the proof-of-model.

### 6.7 — Hardening + launch (M6 · EPIC-13)

- **Slice 16 — Security + ops + legal + launch.** Security pass (zod on every mutation audited, webhook sig verified, rate limits on auth+booking, least-privilege DB user, secrets audit, HTTPS); nightly `pg_dump` to object storage + **tested restore**; WCAG 2.1 AA on public + booking flows; UK GDPR (cookie consent, privacy policy, retention/deletion paths, legal pages); Sentry/PostHog dashboards + health checks; SEO + performance budget; **switch Stripe to live**, seed real launch vendors, soft launch. *AC: Tours + Events MVP live to real users on live Stripe.*

---

## 7. Definition of Done (app-level)

Inherits the MVP Implementation Plan's §16 DoD. In app terms, the MVP is done when, on production with live Stripe:

1. The §6.1–§6.3 loop runs end to end for a real tourist: register → verify → search/map → save to trip → book → pay → confirmation email.
2. A single checkout spans two vendors and settles via separate charges & transfers, each vendor paid share-minus-commission.
3. A vendor self-onboards, passes KYC, creates listings + timed-slot availability, receives bookings, sees payout status.
4. An admin approves/suspends vendors, moderates listings, manages categories, oversees money, issues a refund + transfer reversal.
5. A tourist reviews a completed booking; reviews are moderated.
6. Emails fire on every relevant transition.
7. SEO, security pass, nightly backups with a tested restore, monitoring, accessibility baseline, and UK GDPR legal pages are all in place.
8. `pnpm lint`, `pnpm typecheck`, `pnpm build` pass; CI is green on `main`.

---

## 8. Immediate next actions (first PRs)

In order, small and focused:

1. **`chore: drop stale prisma-8 template doc, fix README to classic Prisma workflow`** — remove the misleading `prisma-8.md`, correct `README.md` to the real `schema.prisma` + `migrate` flow.
2. **`feat(lib): typed env surface + full .env.example`** (Slice 0a).
3. **`feat(lib): stripe/email/storage/jobs adapter skeletons`** (Slice 0b).
4. **`build: vitest + playwright + github actions ci`** (Slice 0c).
5. **`feat(auth): wire better auth, reconcile User model, verification + reset`** (Slice 1) — the first feature slice, and the one that unblocks every surface.

After these five, the repo has a tested, deployable, authenticated foundation and the build proceeds slice by slice down §6.

---

## 9. Watch-outs specific to this codebase

- **Prisma version confusion.** `prisma-8.md` describes a different ORM than the one actually installed. The installed stack is classic Prisma 6 (`@prisma/client` ^6.2) with `prisma migrate`. Trust `schema.prisma` and `package.json`, not that doc.
- **Better Auth ↔ hand-written `User`.** The `User` model was written by hand before Better Auth was wired. Reconcile ownership during Slice 1 before any auth-dependent feature — getting this wrong later means a painful migration once bookings/vendors FK to users.
- **Next.js 16 is not the Next.js in training data.** `AGENTS.md` is explicit: read `node_modules/next/dist/docs/` before writing framework-level code (routing, server actions, caching, metadata). Heed the deprecation notices the dev server injects.
- **PostGIS is deferred.** Map/search must use `lat`/`lng` for the MVP. Don't write PostGIS queries against the dev DB; leave the seam (the §1 schema note) for the later generated geography column.
- **One stateful service.** No Redis for MVP — holds, queue, and rate limiting all run on Postgres. Keep it that way unless contention forces a change.
```
