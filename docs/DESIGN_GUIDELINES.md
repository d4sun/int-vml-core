# VisitMyLondon — Design Guidelines

*The visual language for the VML customer site, derived from the approved design screens. This is the reference every UI component follows. It pairs with the Web App Implementation Plan (which owns architecture and build order).*

**Status:** Living document · **Scope:** `www` customer surface (vendor/admin inherit the tokens, not the marketing chrome)

---

## 1. Brand foundations

VML reads as a confident, editorial London travel brand: deep royal navy, a vivid British crimson for action, generous photography, rounded cards. The feel is "premium guidebook that also lets you book."

### Colour

Brand values live as CSS variables in `app/globals.css` and are exposed as Tailwind utilities (`bg-vml-navy`, `text-vml-red`, …). The neutral/semantic shadcn tokens (`primary`, `muted`, `border`, …) are kept intact so the base component library keeps working.

| Token | Utility | Role |
|---|---|---|
| `--vml-navy` | `bg-vml-navy` / `text-vml-navy` | Top utility bar, royal bands, newsletter band, primary section headings on dark, sidebar CTA, active pills on the detail map/tabs. |
| `--vml-red` | `bg-vml-red` / `text-vml-red` | Primary CTA ("Subscribe", "Select tickets"), the active nav pill ("Home"), category eyebrows, price links, "Book" actions. The single accent that means *act*. |
| `--vml-pink` | `bg-vml-pink` | The magenta "Discover more with London videos" band only. |
| `--vml-green` | `text-vml-green` | Positive status tags — "Free Entry", "Top Rated", "View area". |
| `--vml-ink` | `bg-vml-ink` / `text-vml-ink` | Near-black footer background; default heading/body ink on light. |
| shadcn `muted` / `border` / `card` | as-is | Surfaces, hairlines, card backgrounds. |

Rules of thumb:
- **One red per view for the primary action.** Everything else that's clickable is navy or plain text.
- **Green is a label, not a button.** It signals price/status, never an action target.
- Dark sections (navy, ink, pink) use white text at 70–85% opacity for secondary copy.

### Typography

- **Family:** Geist (sans) for everything; Geist Mono only for incidental mono (kbd hints). Loaded in `app/layout.tsx`.
- **Scale (Tailwind):** hero `text-4xl`→`text-6xl` bold; page H1 `text-3xl`–`text-4xl` bold; section H2 `text-2xl`/`text-lg` bold; card title `text-base` bold; body `text-sm`; meta/caption `text-xs` in `text-muted-foreground`.
- **Eyebrows** (the little red kicker above headings, e.g. "— Don't miss out", category labels on cards) are `text-[11px] font-semibold tracking-wide uppercase text-vml-red`.

### Shape, spacing, elevation

- **Radius:** cards and inputs `rounded-xl`; pills, chips, avatars and icon buttons `rounded-full`; the booking widget and "what's included" card `rounded-2xl`.
- **Page width:** `max-w-7xl` centered with `px-4 sm:px-6`. The category pill row narrows to `max-w-4xl`.
- **Elevation:** cards are flat with a `border-border` hairline; hover adds `shadow-md`. The booking widget carries a persistent `shadow-sm`.
- **Imagery:** listing cards `aspect-[4/3]`, attraction tiles `aspect-[4/5]`, musical posters `aspect-[3/4]`, always `object-cover`, subtle `group-hover:scale-105`.

---

## 2. Layout system

Every customer page is wrapped by the root layout: **SiteHeader → `<main>` → SiteFooter**.

**Marketing/index pages** (home, category) stack full-bleed bands:
`PageHero` → white `CategoryPills` row → two-column body (`FilterSidebar` + card grid) → `Pagination` → `VideoBand` → `NearbyRail` → `NewsletterCta`.

**Detail pages** (listing, event) use a contained header + gallery, then a `[1fr_360px]` two-column grid (content left, sticky booking/summary rail right), then map + nearby + newsletter.

Breakpoints: single column on mobile; the filter sidebar and booking rail drop below the content under `lg`. Card grids go 1 → 2 (`sm`) → 3 (`lg`).

---

## 3. Component inventory

All brand components live in `components/brand/`; primitives extend the existing shadcn set in `components/ui/`. They are built on `@base-ui/react` (the repo's shadcn `base-nova` style), **not** Radix, and import `cn` from the `"cn"` package to match the existing `button.tsx`.

| Component | File | Notes |
|---|---|---|
| `Logo` | `brand/logo.tsx` | "Visit My LONDON" wordmark, landmark glyph + Union-flag "O". `tone="light"` on navy. |
| `SiteHeader` | `brand/site-header.tsx` | Navy utility bar (logo, search, currency/globe/menu) + white nav row with hover dropdowns + red active pill. Mobile menu. Client. |
| `SiteFooter` | `brand/site-footer.tsx` | Ink mega-footer: brand column + 6 link columns + legal strip. |
| `NewsletterCta` | `brand/newsletter-cta.tsx` | Navy "Plan Your Perfect London Trip" band with email capture. |
| `VideoBand` | `brand/video-band.tsx` | Pink video rail. |
| `NearbyRail` | `brand/nearby-rail.tsx` | "More experiences nearby" horizontal booking cards. |
| `PageHero` | `brand/page-hero.tsx` | Photo hero: breadcrumb, title, subtitle, inline "Ask MYLO" search. |
| `CategoryPills` | `brand/category-pills.tsx` | Wrap-around category filter pills; active = navy fill. |
| `FilterSidebar` | `brand/filter-sidebar.tsx` | "Advanced Filters" collapsible facet groups + checkboxes + counts + navy "Show N places" CTA. Client. |
| `ListingCard` | `brand/listing-card.tsx` | Standard discovery card: image + heart, red eyebrow, title, meta, green tag, "View area →". |
| `Pagination` | `brand/pagination.tsx` | Numbered pager (1 … 20) + result count. |
| `CategoryPage` | `brand/category-page.tsx` | Assembles the whole category template from a `CategoryConfig`. |
| `DetailGallery` | `brand/detail-gallery.tsx` | 1 big + 4 thumb grid with "+N photos" overlay. |
| `BookingWidget` | `brand/booking-widget.tsx` | Sticky navy-topped rail: price, date, ticket-type steppers, red CTA, trust row. Client. |
| `AccordionList` | `brand/accordion-list.tsx` | Visitor-guide Q&A accordion. Client. |
| `ReviewsBlock` | `brand/reviews-block.tsx` | Rating summary + distribution bars + review cards. |
| `MapPlaceholder` | `brand/map-placeholder.tsx` | Static Google-Maps-style placeholder (no live map yet). |
| `EventTabs` | `brand/event-tabs.tsx` | Overview/Location tabs for the event page. Client. |

Primitives added: `ui/badge.tsx` (incl. `eyebrow`, `green`, `tag`, `navy`, `red` variants), `ui/input.tsx`. The existing `ui/button.tsx` is reused unchanged.

---

## 4. Interaction & state conventions

- **Dropdowns** in the nav open on hover/focus via a `group` + opacity transition — no JS menu dependency, keyboard-focusable.
- **Steppers / checkboxes / tabs / accordions** hold local React state in client components; nothing is wired to data yet (this is a UI-only pass).
- **Hover:** cards lift (`shadow-md`) and images scale; links underline or shift to red/navy.
- **Focus:** inherits the shadcn ring tokens (`focus-visible:ring-ring/50`).

---

## 5. Accessibility baseline

- All icon-only controls carry `aria-label`.
- Checkboxes use `role="checkbox"` + `aria-checked`; tabs/accordions are real buttons.
- Colour is never the only signal — tags carry text, the active pill changes fill *and* weight.
- Target WCAG 2.1 AA on the booking flow (the implementation plan's NFR); contrast of navy/red/ink on white and white on navy/red all pass AA for text sizes used.

---

## 6. What's intentionally deferred

This pass is **UI only, mock data**. Not yet done, by design:
- Real data (everything reads from `lib/mock-data.ts`).
- Live search, live map (static placeholder), working filters/sort/pagination.
- Auth-gated surfaces, vendor/admin chrome.
- Dark-mode polish (tokens exist and resolve, but the marketing screens were designed light-first and haven't been dark-reviewed).
- Real photography/licensing (Unsplash URLs are placeholders for layout only — replace before any public launch).

---

## 7. Extending the system

When adding a new category page, add a `CategoryConfig` entry to `lib/mock-data.ts` — the `[category]` route renders it automatically. When adding a new brand component, keep it in `components/brand/`, build on `@base-ui/react` + the `vml-*` tokens, and register it in the table above. Never hard-code hex values in a component; add a token to `globals.css` and reference it so light/dark and future rebrands stay single-sourced.
