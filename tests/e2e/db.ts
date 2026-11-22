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
export async function createVendor(
  status: VendorStatus
): Promise<{ id: string; name: string; ownerName: string }> {
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

  return { id: vendor.id, name: vendor.name, ownerName }
}
