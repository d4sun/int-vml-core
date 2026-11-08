import 'dotenv/config'
import { PrismaClient, CategoryType, VendorStatus, ListingStatus, ProductKind } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  // One category (Tours — TIMED_SLOT), one vendor, one listing, one product,
  // one availability slot. Satisfies the M0 exit gate: a seeded listing is
  // bookable in test mode.
  const category = await prisma.category.upsert({
    where: { slug: 'tours' },
    update: {},
    create: {
      name: 'Tours',
      slug: 'tours',
      type: CategoryType.TIMED_SLOT,
      commissionBpsDefault: 1000,
    },
  })

  const vendor = await prisma.vendor.upsert({
    where: { slug: 'seed-tours-co' },
    update: {},
    create: {
      name: 'Seed Tours Co.',
      slug: 'seed-tours-co',
      description: 'A seeded vendor for local development.',
      status: VendorStatus.APPROVED,
      stripeOnboardingComplete: false,
      contactEmail: 'vendor@example.com',
    },
  })

  const listing = await prisma.listing.upsert({
    where: { slug: 'thames-walking-tour' },
    update: {},
    create: {
      vendorId: vendor.id,
      categoryId: category.id,
      title: 'Thames Walking Tour',
      slug: 'thames-walking-tour',
      description: 'A guided two-hour walk along the South Bank.',
      lat: 51.5079,
      lng: -0.1156,
      address: 'South Bank, London SE1',
      status: ListingStatus.PUBLISHED,
    },
  })

  const product = await prisma.product.create({
    data: {
      listingId: listing.id,
      name: 'Standard ticket',
      kind: ProductKind.TIMED_SLOT,
      basePrice: 2500, // £25.00 in pence
      currency: 'GBP',
      policy: { cancelWindowHours: 24, bookingCutoffHours: 2 },
      active: true,
    },
  })

  const start = new Date()
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

  console.log('Seed complete:', { category: category.slug, vendor: vendor.slug, listing: listing.slug })
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
