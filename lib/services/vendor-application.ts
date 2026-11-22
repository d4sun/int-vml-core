import type { PrismaClient, VendorStatus } from "@prisma/client"
import { toNormalizedError } from "@/lib/actions/result"
import { requireUser, type SessionSource } from "@/lib/auth/guards"
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors"
import { audit } from "@/lib/services/audit"
import { vendorApplicationSchema } from "@/lib/validation/vendor-application"
import { randomSlugSuffix, vendorSlug } from "@/lib/vendors/slug"

export type AppliedVendor = {
  id: string
  name: string
  slug: string
  status: VendorStatus
}

export type VendorApplicationDeps = {
  session?: SessionSource
  db?: Pick<PrismaClient, "$transaction">
  record?: typeof audit.record
  /** Overridable so tests can force a slug collision. */
  randomSuffix?: () => string
}

const SLUG_ATTEMPTS = 5

/**
 * Applies to become a vendor: creates a PENDING vendor with the caller as its
 * OWNER. The caller's platform role is not touched here; they become a VENDOR
 * only when an admin approves (see `transitionVendor`), so applying grants no
 * access to anything.
 *
 * One open application per applicant: while one of their vendors is PENDING a
 * second is a ConflictError. Concurrent requests are serialised by locking the
 * applicant's user row, so two clicks cannot both pass the check. A rejected
 * applicant may apply again as a new vendor. Administrators cannot apply.
 */
export async function applyAsVendor(
  input: unknown,
  deps: VendorApplicationDeps = {}
): Promise<AppliedVendor> {
  const actor = await requireUser(deps.session)

  if (actor.platformRole === "ADMIN") {
    throw new ForbiddenError("Administrators cannot apply to become a vendor")
  }

  const parsed = vendorApplicationSchema.safeParse(input)

  if (!parsed.success) throw toNormalizedError(parsed.error)

  const { name, description, contactEmail } = parsed.data
  const db = deps.db ?? (await import("@/lib/prisma")).prisma
  const record = deps.record ?? audit.record
  const suffix = deps.randomSuffix ?? randomSlugSuffix

  return db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT "id" FROM "User" WHERE "id" = ${actor.id} FOR UPDATE`

    if (locked.length === 0) throw new NotFoundError("Account not found")

    const open = await tx.vendor.findFirst({
      where: {
        status: "PENDING",
        members: { some: { userId: actor.id, role: "OWNER" } },
      },
      select: { id: true },
    })

    if (open) {
      throw new ConflictError(
        "You already have an application under review. We'll email you once it has been decided."
      )
    }

    let slug = vendorSlug(name, suffix())

    for (let attempt = 1; attempt < SLUG_ATTEMPTS; attempt += 1) {
      if (
        !(await tx.vendor.findUnique({ where: { slug }, select: { id: true } }))
      ) {
        break
      }

      slug = vendorSlug(name, suffix())
    }

    const vendor = await tx.vendor.create({
      data: {
        name,
        slug,
        status: "PENDING",
        contactEmail: contactEmail ?? actor.email,
        ...(description ? { description } : {}),
        members: { create: { userId: actor.id, role: "OWNER" } },
      },
      select: { id: true, name: true, slug: true, status: true },
    })

    await record(tx, {
      actorId: actor.id,
      action: "vendor.applied",
      entityType: "Vendor",
      entityId: vendor.id,
      meta: { name },
    })

    return vendor
  })
}
