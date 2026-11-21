import {
  CategoryType,
  ListingStatus,
  PlatformRole,
  ProductKind,
  VendorRole,
  VendorStatus,
  type PrismaClient,
} from "@prisma/client"
import { hashPassword, verifyPassword } from "better-auth/crypto"

/**
 * DEVELOPMENT AND TEST DATA ONLY. These accounts have a publicly known
 * password and privileged roles; seeding refuses to run in production.
 *
 * The `.test` TLD is reserved (RFC 2606), so these addresses can never belong
 * to a real person or receive real mail.
 */
export const SEED_USERS = [
  {
    key: "admin",
    email: "admin@seed.vml.test",
    name: "Seed Admin",
    platformRole: PlatformRole.ADMIN,
  },
  {
    key: "owner",
    email: "owner@seed.vml.test",
    name: "Seed Vendor Owner",
    platformRole: PlatformRole.VENDOR,
    vendorRole: VendorRole.OWNER,
  },
  {
    key: "staff",
    email: "staff@seed.vml.test",
    name: "Seed Vendor Staff",
    platformRole: PlatformRole.VENDOR,
    vendorRole: VendorRole.STAFF,
  },
  {
    key: "tourist",
    email: "tourist@seed.vml.test",
    name: "Seed Tourist",
    platformRole: PlatformRole.TOURIST,
  },
] as const

export type SeedUserKey = (typeof SEED_USERS)[number]["key"]

export const DEFAULT_SEED_PASSWORD = "Seed-password-1"

export const SEED_VENDOR_SLUG = "seed-tours-co"

export function assertSeedAllowed(
  env: Record<string, string | undefined> = process.env
): void {
  if (env.NODE_ENV === "production") {
    throw new Error(
      "Refusing to seed: NODE_ENV is production. The seed creates privileged accounts with a published password."
    )
  }
}

export type SeedOptions = {
  password?: string
  now?: Date
}

export type SeedResult = {
  userIds: Record<SeedUserKey, string>
  vendorId: string
}

/**
 * Idempotent: running it again leaves the same rows (no duplicates). Roles and
 * vendor approval are re-asserted each run; a credential's hash is rewritten
 * only when `password` no longer matches it.
 */
export async function seedDatabase(
  prisma: PrismaClient,
  options: SeedOptions = {}
): Promise<SeedResult> {
  const password = options.password ?? DEFAULT_SEED_PASSWORD
  const now = options.now ?? new Date()

  const userIds = {} as Record<SeedUserKey, string>

  for (const seed of SEED_USERS) {
    const user = await prisma.user.upsert({
      where: { email: seed.email },
      update: {
        name: seed.name,
        emailVerified: true,
        platformRole: seed.platformRole,
      },
      create: {
        email: seed.email,
        name: seed.name,
        emailVerified: true,
        platformRole: seed.platformRole,
      },
    })

    userIds[seed.key] = user.id

    const credential = await prisma.account.findFirst({
      where: { userId: user.id, providerId: "credential" },
    })

    if (!credential) {
      await prisma.account.create({
        data: {
          userId: user.id,
          providerId: "credential",
          accountId: user.id,
          password: await hashPassword(password),
        },
      })
    } else if (
      !credential.password ||
      !(await verifyPassword({ hash: credential.password, password }))
    ) {
      await prisma.account.update({
        where: { id: credential.id },
        data: { password: await hashPassword(password) },
      })
    }
  }

  const category = await prisma.category.upsert({
    where: { slug: "tours" },
    update: {},
    create: {
      name: "Tours",
      slug: "tours",
      type: CategoryType.TIMED_SLOT,
      commissionBpsDefault: 1000,
    },
  })

  const vendor = await prisma.vendor.upsert({
    where: { slug: SEED_VENDOR_SLUG },
    update: {
      status: VendorStatus.APPROVED,
      approvedByAdminId: userIds.admin,
    },
    create: {
      name: "Seed Tours Co.",
      slug: SEED_VENDOR_SLUG,
      description: "A seeded vendor for local development.",
      status: VendorStatus.APPROVED,
      approvedByAdminId: userIds.admin,
      stripeOnboardingComplete: false,
      contactEmail: "vendor@example.com",
    },
  })

  for (const seed of SEED_USERS) {
    if (!("vendorRole" in seed)) continue

    await prisma.vendorMember.upsert({
      where: {
        userId_vendorId: { userId: userIds[seed.key], vendorId: vendor.id },
      },
      update: { role: seed.vendorRole },
      create: {
        userId: userIds[seed.key],
        vendorId: vendor.id,
        role: seed.vendorRole,
      },
    })
  }

  const listing = await prisma.listing.upsert({
    where: { slug: "thames-walking-tour" },
    update: {},
    create: {
      vendorId: vendor.id,
      categoryId: category.id,
      title: "Thames Walking Tour",
      slug: "thames-walking-tour",
      description: "A guided two-hour walk along the South Bank.",
      lat: 51.5079,
      lng: -0.1156,
      address: "South Bank, London SE1",
      status: ListingStatus.PUBLISHED,
    },
  })

  const product =
    (await prisma.product.findFirst({
      where: { listingId: listing.id, name: "Standard ticket" },
    })) ??
    (await prisma.product.create({
      data: {
        listingId: listing.id,
        name: "Standard ticket",
        kind: ProductKind.TIMED_SLOT,
        basePrice: 2500, // £25.00 in pence
        currency: "GBP",
        policy: { cancelWindowHours: 24, bookingCutoffHours: 2 },
        active: true,
      },
    }))

  // Keep one bookable future slot available: a re-run after the old slot has
  // passed adds a new one, while a re-run before that adds nothing.
  const futureSlot = await prisma.availability.findFirst({
    where: { productId: product.id, startAt: { gt: now } },
  })

  if (!futureSlot) {
    const start = new Date(now)
    start.setDate(start.getDate() + 3)
    start.setHours(10, 0, 0, 0)
    const end = new Date(start)
    end.setHours(12, 0, 0, 0)

    await prisma.availability.create({
      data: {
        productId: product.id,
        startAt: start,
        endAt: end,
        capacity: 20,
        remaining: 20,
      },
    })
  }

  return { userIds, vendorId: vendor.id }
}
