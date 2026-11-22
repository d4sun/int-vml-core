const MAX_BASE_LENGTH = 40

/**
 * A URL-safe, lower-case form of a business name: accents are dropped, runs of
 * anything else become one hyphen, and nothing leads or trails. A name with no
 * usable characters (for example only emoji) becomes `vendor`.
 */
export function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_BASE_LENGTH)
    .replace(/-+$/g, "")

  return slug || "vendor"
}

/** `thames-tours-k3x9ab`: the suffix keeps names that slugify alike apart. */
export function vendorSlug(name: string, suffix: string): string {
  return `${slugify(name)}-${suffix}`
}

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789"

/** Six random characters, about two billion combinations per base slug. */
export function randomSlugSuffix(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6))

  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join("")
}
