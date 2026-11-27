import { Prisma, type PrismaClient } from "@prisma/client"
import { publiclyVisibleListingWhere } from "@/lib/catalog/visibility"
import {
  searchQuerySchema,
  SEARCH_PAGE_SIZE,
  type SearchQuery,
} from "@/lib/validation/search"
import { ValidationError } from "@/lib/errors"
import { londonDayBounds } from "@/lib/time/london"
import { boxCentre, EARTH_RADIUS_KM, type LatLng } from "@/lib/search/geo"

export type SearchResult = {
  id: string
  title: string
  slug: string
  categoryName: string
  vendorName: string
  /** The cheapest active product, in pence; null when there is none in range. */
  fromPrice: number | null
  /** Storage key of the first picture, or null when there is none. */
  imageKey: string | null
  /** Where the listing is, for the map; null when the vendor gave none. */
  lat: number | null
  lng: number | null
}

export type SearchPage = {
  listings: SearchResult[]
  total: number
  page: number
  pageSize: number
}

export type SearchDeps = {
  db?: Pick<PrismaClient, "listing" | "category" | "$queryRaw">
}

/**
 * The public search. Every condition is combined with AND, so a filter can only
 * narrow the result, never widen it. Visibility is the single definition in
 * `publiclyVisibleListingWhere`: the candidate ids are found in SQL with the
 * same conditions, and the rows are then loaded through that Prisma `where`
 * before anything is returned, so a listing that is not public never leaves here.
 *
 * Text is matched against the generated `search` column (title weighted above
 * description) and ranked by relevance; with no text, newest title order.
 */
export async function searchListings(
  input: unknown,
  deps: SearchDeps = {}
): Promise<SearchPage> {
  const parsed = searchQuerySchema.safeParse(input)

  if (!parsed.success) {
    throw new ValidationError("Check the search filters", flatten(parsed.error))
  }

  const query = parsed.data
  const db = deps.db ?? (await import("@/lib/prisma")).prisma

  const candidates = await candidateIds(db, query)

  if (candidates.ids.length === 0) {
    return {
      listings: [],
      total: candidates.total,
      page: query.page,
      pageSize: SEARCH_PAGE_SIZE,
    }
  }

  const rows = await db.listing.findMany({
    where: publiclyVisibleListingWhere({ id: { in: candidates.ids } }),
    select: {
      id: true,
      title: true,
      slug: true,
      lat: true,
      lng: true,
      category: { select: { name: true } },
      vendor: { select: { name: true } },
      products: {
        where: { active: true },
        select: { basePrice: true },
        orderBy: { basePrice: "asc" },
        take: 1,
      },
      images: {
        select: { key: true },
        orderBy: { position: "asc" },
        take: 1,
      },
    },
  })

  const byId = new Map(rows.map((row) => [row.id, row]))

  const listings = candidates.ids
    .map((id) => byId.get(id))
    .filter((row): row is NonNullable<typeof row> => row !== undefined)
    .map((row) => ({
      id: row.id,
      title: row.title,
      slug: row.slug,
      categoryName: row.category.name,
      vendorName: row.vendor.name,
      fromPrice: row.products[0]?.basePrice ?? null,
      imageKey: row.images[0]?.key ?? null,
      lat: row.lat,
      lng: row.lng,
    }))

  return {
    listings,
    total: candidates.total,
    page: query.page,
    pageSize: SEARCH_PAGE_SIZE,
  }
}

async function candidateIds(
  db: Pick<PrismaClient, "$queryRaw">,
  query: SearchQuery
): Promise<{ ids: string[]; total: number }> {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`l."status" = 'PUBLISHED'`,
    Prisma.sql`v."status" = 'APPROVED'`,
  ]

  if (query.q) {
    conditions.push(
      Prisma.sql`l."search" @@ websearch_to_tsquery('english', ${query.q})`
    )
  }

  if (query.category) {
    conditions.push(Prisma.sql`c."slug" = ${query.category}`)
  }

  if (query.minPrice !== undefined || query.maxPrice !== undefined) {
    const range: Prisma.Sql[] = [
      Prisma.sql`p."listingId" = l."id"`,
      Prisma.sql`p."active" = true`,
    ]

    if (query.minPrice !== undefined) {
      range.push(Prisma.sql`p."basePrice" >= ${query.minPrice}`)
    }

    if (query.maxPrice !== undefined) {
      range.push(Prisma.sql`p."basePrice" <= ${query.maxPrice}`)
    }

    conditions.push(
      Prisma.sql`EXISTS (SELECT 1 FROM "Product" p WHERE ${Prisma.join(range, " AND ")})`
    )
  }

  if (query.date) {
    const [year, month, day] = query.date.split("-").map(Number) as [
      number,
      number,
      number,
    ]
    const { from, to } = londonDayBounds({ year, month, day })

    // A slot counts only if it is open (not closed, capacity left) and starts
    // after its product's booking cutoff, measured from now in UTC (CR-6).
    conditions.push(
      Prisma.sql`EXISTS (
        SELECT 1 FROM "Product" p
        JOIN "Availability" a ON a."productId" = p."id"
        WHERE p."listingId" = l."id"
          AND p."active" = true
          AND a."closed" = false
          AND a."remaining" > 0
          AND a."startAt" >= ${from}
          AND a."startAt" < ${to}
          AND a."startAt" > now() + make_interval(
            hours => COALESCE((p."policy"->>'bookingCutoffHours')::int, 0)
          )
      )`
    )
  }

  const box =
    query.south !== undefined &&
    query.north !== undefined &&
    query.west !== undefined &&
    query.east !== undefined
      ? {
          south: query.south,
          north: query.north,
          west: query.west,
          east: query.east,
        }
      : undefined

  if (box) {
    // A listing without a location cannot be on a map, so it is left out.
    conditions.push(
      Prisma.sql`l."lat" BETWEEN ${box.south} AND ${box.north} AND l."lng" BETWEEN ${box.west} AND ${box.east}`
    )
  }

  const where = Prisma.join(conditions, " AND ")
  const from = Prisma.sql`FROM "Listing" l
    JOIN "Vendor" v ON v."id" = l."vendorId"
    JOIN "Category" c ON c."id" = l."categoryId"`

  const order = query.q
    ? Prisma.sql`ts_rank(l."search", websearch_to_tsquery('english', ${query.q})) DESC, l."title" ASC, l."id" ASC`
    : box
      ? Prisma.sql`${distanceSql(boxCentre(box))} ASC, l."id" ASC`
      : Prisma.sql`l."title" ASC, l."id" ASC`

  const offset = (query.page - 1) * SEARCH_PAGE_SIZE

  const [rows, counted] = await Promise.all([
    db.$queryRaw<{ id: string }[]>`
      SELECT l."id" ${from}
      WHERE ${where}
      ORDER BY ${order}
      LIMIT ${SEARCH_PAGE_SIZE} OFFSET ${offset}
    `,
    db.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(*) AS total ${from}
      WHERE ${where}
    `,
  ])

  return {
    ids: rows.map((row) => row.id),
    total: Number(counted[0]?.total ?? 0),
  }
}

function flatten(error: {
  issues: { path: PropertyKey[]; message: string }[]
}) {
  const fieldErrors: Record<string, string[]> = {}

  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form")
    ;(fieldErrors[key] ??= []).push(issue.message)
  }

  return fieldErrors
}

/** The haversine distance in SQL, the same formula as `haversineKm`. */
function distanceSql(centre: LatLng): Prisma.Sql {
  return Prisma.sql`(${EARTH_RADIUS_KM} * 2 * asin(sqrt(
    power(sin(radians((l."lat" - ${centre.lat}) / 2)), 2) +
    cos(radians(${centre.lat})) * cos(radians(l."lat")) *
    power(sin(radians((l."lng" - ${centre.lng}) / 2)), 2)
  )))`
}

export type SearchCategory = { slug: string; name: string }

/** Every category, for the category filter. Names and slugs only. */
export async function listSearchCategories(
  deps: SearchDeps = {}
): Promise<SearchCategory[]> {
  const db = deps.db ?? (await import("@/lib/prisma")).prisma

  return db.category.findMany({
    select: { slug: true, name: true },
    orderBy: { name: "asc" },
  })
}
