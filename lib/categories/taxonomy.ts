/**
 * The top-level categories a fresh database starts with. They are the
 * bookable groupings the site already shows (`/tours`, `/events`, …). All are
 * timed-slot (the only type implemented) and start at the platform default
 * commission of 10%; an admin changes them afterwards in the editor.
 */
export const SEED_CATEGORIES = [
  { name: "Tours", slug: "tours", commissionBpsDefault: 1000 },
  { name: "Events", slug: "events", commissionBpsDefault: 1000 },
  { name: "Attractions", slug: "attractions", commissionBpsDefault: 1000 },
  { name: "Arts & Culture", slug: "arts-culture", commissionBpsDefault: 1000 },
  { name: "Food & Drink", slug: "food-drink", commissionBpsDefault: 1000 },
  { name: "Nightlife", slug: "nightlife", commissionBpsDefault: 1000 },
  { name: "Music", slug: "music", commissionBpsDefault: 1000 },
] as const
