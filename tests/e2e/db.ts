import { randomUUID } from "node:crypto"
import { PrismaClient, type VendorStatus } from "@prisma/client"

let client: PrismaClient | undefined

function db(): PrismaClient {
  client ??= new PrismaClient()

  return client
}

export async function closeDb(): Promise<void> {
  await client?.$disconnect()
  client = undefined
}

/**
 * Creates a vendor (with an owner, so the queue has an applicant to show)
 * directly in the database. Names are unique so tests find their own rows in
 * a database that earlier runs have already filled.
 */
export async function createVendor(status: VendorStatus): Promise<{
  id: string
  name: string
  ownerName: string
  ownerEmail: string
}> {
  const suffix = randomUUID().slice(0, 8)
  const ownerName = `Olive ${suffix}`
  const owner = await db().user.create({
    data: {
      name: ownerName,
      email: `owner-${suffix}@example.com`,
      emailVerified: true,
      platformRole: "VENDOR",
    },
  })
  const vendor = await db().vendor.create({
    data: {
      name: `E2E Vendor ${suffix}`,
      slug: `e2e-vendor-${suffix}`,
      status,
      members: { create: { userId: owner.id, role: "OWNER" } },
    },
  })

  return {
    id: vendor.id,
    name: vendor.name,
    ownerName,
    ownerEmail: owner.email,
  }
}

/**
 * Makes an existing (registered, verified) user a member of a new vendor with
 * the given status, promoting them to VENDOR as approval would. Returns the
 * vendor so a second user can be attached with `addVendorMember`.
 */
export async function createVendorFor(
  email: string,
  status: VendorStatus,
  options: { stripeAccountId?: string } = {}
): Promise<{ id: string; name: string }> {
  const suffix = randomUUID().slice(0, 8)
  const user = await db().user.update({
    where: { email },
    data: { platformRole: "VENDOR" },
  })
  const vendor = await db().vendor.create({
    data: {
      name: `E2E Payout ${suffix}`,
      slug: `e2e-payout-${suffix}`,
      status,
      ...options,
      members: { create: { userId: user.id, role: "OWNER" } },
    },
  })

  return { id: vendor.id, name: vendor.name }
}

export async function addVendorMember(
  vendorId: string,
  email: string,
  role: "OWNER" | "STAFF"
): Promise<void> {
  const user = await db().user.update({
    where: { email },
    data: { platformRole: "VENDOR" },
  })

  await db().vendorMember.create({ data: { userId: user.id, vendorId, role } })
}

export async function vendorPayoutState(vendorId: string) {
  const vendor = await db().vendor.findUniqueOrThrow({
    where: { id: vendorId },
    select: {
      stripeAccountId: true,
      stripeOnboardingComplete: true,
      stripeRequirementsDue: true,
    },
  })

  return vendor
}

/** Marks a vendor's payout setup complete, as the account.updated webhook would. */
export async function setVendorOnboarded(vendorId: string): Promise<void> {
  await db().vendor.update({
    where: { id: vendorId },
    data: { stripeOnboardingComplete: true },
  })
}

/**
 * A listing waiting for an admin decision, in a category of its own so the
 * queue can be found by its title. Returns the listing's id.
 */
export async function createPendingListing(
  vendorId: string,
  title: string
): Promise<string> {
  const suffix = randomUUID().slice(0, 8)
  const category = await db().category.create({
    data: {
      name: `E2E Cat ${suffix}`,
      slug: `e2e-cat-${suffix}`,
      type: "TIMED_SLOT",
    },
  })
  const listing = await db().listing.create({
    data: {
      vendorId,
      categoryId: category.id,
      title,
      slug: `e2e-listing-${suffix}`,
      description: "A walk for the e2e suite.",
      status: "PENDING_REVIEW",
    },
  })

  return listing.id
}

export async function listingStatus(listingId: string): Promise<string> {
  const listing = await db().listing.findUniqueOrThrow({
    where: { id: listingId },
    select: { status: true },
  })

  return listing.status
}

/**
 * A listing in the given status, with a slug the public pages can be reached
 * by. Returns both, so a spec can check visibility by URL and by id.
 */
export async function createListingWithStatus(
  vendorId: string,
  title: string,
  status: "PUBLISHED" | "DRAFT"
): Promise<{ id: string; slug: string }> {
  const suffix = randomUUID().slice(0, 8)
  const category = await db().category.create({
    data: {
      name: `E2E Public ${suffix}`,
      slug: `e2e-public-${suffix}`,
      type: "TIMED_SLOT",
    },
  })
  const listing = await db().listing.create({
    data: {
      vendorId,
      categoryId: category.id,
      title,
      slug: `e2e-public-listing-${suffix}`,
      description: "Visible on the public pages.",
      status,
      lat: 51.5033,
      lng: -0.1195,
      products: {
        create: {
          name: "Morning walk",
          basePrice: 1500,
          policy: { cancelWindowHours: 24, bookingCutoffHours: 2 },
        },
      },
    },
  })

  return { id: listing.id, slug: listing.slug }
}

/** A vendor's commission override in basis points, or null for the category defaults. */
export async function vendorCommission(
  vendorId: string
): Promise<number | null> {
  const vendor = await db().vendor.findUniqueOrThrow({
    where: { id: vendorId },
    select: { commissionBpsOverride: true },
  })

  return vendor.commissionBpsOverride
}

/** An open slot on a listing's first product, starting at the given time. */
export async function addOpenSlot(
  listingId: string,
  startAt: Date,
  remaining = 5
): Promise<string> {
  const product = await db().product.findFirstOrThrow({
    where: { listingId },
    select: { id: true },
  })
  const slot = await db().availability.create({
    data: {
      productId: product.id,
      startAt,
      endAt: new Date(startAt.getTime() + 60 * 60 * 1000),
      capacity: remaining,
      remaining,
    },
  })

  return slot.id
}
