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
