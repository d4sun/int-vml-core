import type { PrismaClient } from "@prisma/client"
import { publiclyVisibleListingWhere } from "@/lib/catalog/visibility"

export type PublicListing = {
  id: string
  slug: string
  title: string
  description: string | null
  address: string | null
  lat: number | null
  lng: number | null
  categoryName: string
  vendorName: string
  /** Active products, cheapest first. */
  products: {
    id: string
    name: string
    basePrice: number
    cancelWindowHours: number
  }[]
  /** Storage keys of the pictures, in the order the vendor set. */
  imageKeys: string[]
}

export type PublicListingDeps = {
  db?: Pick<PrismaClient, "listing">
}

/**
 * One listing as the public may see it, or null. The lookup goes through
 * `publiclyVisibleListingWhere`, so a draft, a pending or rejected listing, or a
 * listing of a suspended vendor is "not found", exactly as if it did not exist.
 */
export async function getPublicListing(
  slug: string,
  deps: PublicListingDeps = {}
): Promise<PublicListing | null> {
  const db = deps.db ?? (await import("@/lib/prisma")).prisma

  const row = await db.listing.findFirst({
    where: publiclyVisibleListingWhere({ slug }),
    select: {
      id: true,
      slug: true,
      title: true,
      description: true,
      address: true,
      lat: true,
      lng: true,
      category: { select: { name: true } },
      vendor: { select: { name: true } },
      products: {
        where: { active: true },
        orderBy: { basePrice: "asc" },
        select: { id: true, name: true, basePrice: true, policy: true },
      },
      images: { orderBy: { position: "asc" }, select: { key: true } },
    },
  })

  if (!row) return null

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    address: row.address,
    lat: row.lat,
    lng: row.lng,
    categoryName: row.category.name,
    vendorName: row.vendor.name,
    products: row.products.map((product) => ({
      id: product.id,
      name: product.name,
      basePrice: product.basePrice,
      cancelWindowHours: cancelWindowOf(product.policy),
    })),
    imageKeys: row.images.map((image) => image.key),
  }
}

/** The policy is stored as JSON; a missing or malformed value reads as 0 hours. */
function cancelWindowOf(policy: unknown): number {
  if (typeof policy !== "object" || policy === null) return 0
  const hours = (policy as { cancelWindowHours?: unknown }).cancelWindowHours

  return typeof hours === "number" && Number.isFinite(hours) ? hours : 0
}
