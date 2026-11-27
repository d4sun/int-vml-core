const MAX_LENGTH = 60

/**
 * Slugs are public URLs (`/<slug>`), so they are clean, lower-case words with
 * no random suffix. A name with nothing usable in it gives an empty string and
 * the caller must ask for a slug.
 */
export function categorySlug(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_LENGTH)
    .replace(/-+$/g, "")
}

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * A category slug is a top-level URL segment, so it must not shadow a route
 * of the app. Every static segment directly under `app/` must be listed
 * (`tests/unit/category-slug.test.ts` fails when one is missing); the rest
 * are routes planned in the backlog and framework paths.
 */
export const RESERVED_CATEGORY_SLUGS: ReadonlySet<string> = new Set([
  // Routes that exist
  "account",
  "admin",
  "api",
  "event",
  "explore",
  "forgot-password",
  "listing",
  "listings",
  "register",
  "reset-password",
  "sign-in",
  "vendor",
  "verify-email",
  // Planned or framework. "events" is deliberately absent: `/events` is a
  // category (backlog §12.2), served by the same `[category]` route.
  "about",
  "bookings",
  "cart",
  "checkout",
  "help",
  "map",
  "privacy",
  "search",
  "sign-out",
  "sitemap",
  "terms",
  "trip",
  "trips",
  "_next",
  "robots",
])
