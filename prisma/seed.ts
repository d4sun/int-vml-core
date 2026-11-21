import "dotenv/config"
import { PrismaClient } from "@prisma/client"
import {
  DEFAULT_SEED_PASSWORD,
  SEED_USERS,
  assertSeedAllowed,
  seedDatabase,
} from "./seed-core"

async function main() {
  assertSeedAllowed()

  const prisma = new PrismaClient()

  try {
    const password = process.env.SEED_PASSWORD || DEFAULT_SEED_PASSWORD
    const result = await seedDatabase(prisma, { password })

    console.log("Seed complete (development data only).")
    console.table(
      SEED_USERS.map((user) => ({
        email: user.email,
        role: user.platformRole,
        vendorRole: "vendorRole" in user ? user.vendorRole : "",
      }))
    )
    console.log(
      process.env.SEED_PASSWORD
        ? "Password: the value of SEED_PASSWORD."
        : `Password for all seeded users: ${DEFAULT_SEED_PASSWORD}`
    )
    console.log("Vendor:", result.vendorId)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
