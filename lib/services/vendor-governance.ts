import type { PrismaClient, VendorStatus } from "@prisma/client"
import { toNormalizedError } from "@/lib/actions/result"
import { requireAdmin, type SessionSource } from "@/lib/auth/guards"
import { ConflictError, NotFoundError } from "@/lib/errors"
import { audit } from "@/lib/services/audit"
import { vendorTransitionSchema } from "@/lib/validation/vendor-governance"
import { auditActionFor, nextVendorStatus } from "@/lib/vendors/transitions"

export type GovernedVendor = {
  id: string
  name: string
  slug: string
  status: VendorStatus
  approvedByAdminId: string | null
}

export type VendorGovernanceDeps = {
  session?: SessionSource
  db?: Pick<PrismaClient, "$transaction">
  /** Overridable so tests can prove the status change and audit row are atomic. */
  record?: typeof audit.record
}

/**
 * Approves, rejects, suspends or reinstates a vendor (admin only).
 *
 * The admin check comes first and nothing about the input or the vendor is
 * revealed to anyone else. The status change and its audit row are one
 * transaction, and the update is guarded by the status that was read, so two
 * admins acting at once cannot both succeed: the loser gets a ConflictError
 * and no audit row.
 */
export async function transitionVendor(
  input: unknown,
  deps: VendorGovernanceDeps = {}
): Promise<GovernedVendor> {
  const actor = await requireAdmin(deps.session)

  const parsed = vendorTransitionSchema.safeParse(input)

  if (!parsed.success) throw toNormalizedError(parsed.error)

  const { vendorId, action, reason } = parsed.data
  const db = deps.db ?? (await import("@/lib/prisma")).prisma
  const record = deps.record ?? audit.record

  return db.$transaction(async (tx) => {
    const vendor = await tx.vendor.findUnique({
      where: { id: vendorId },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        approvedByAdminId: true,
      },
    })

    if (!vendor) throw new NotFoundError("Vendor not found")

    const next = nextVendorStatus(vendor.status, action)
    const approvedByAdminId =
      action === "approve" ? actor.id : vendor.approvedByAdminId

    const { count } = await tx.vendor.updateMany({
      where: { id: vendorId, status: vendor.status },
      data: { status: next, approvedByAdminId },
    })

    if (count === 0) {
      throw new ConflictError(
        "This vendor was just changed by someone else. Refresh and try again."
      )
    }

    await record(tx, {
      actorId: actor.id,
      action: auditActionFor(action),
      entityType: "Vendor",
      entityId: vendorId,
      meta: { from: vendor.status, to: next, ...(reason ? { reason } : {}) },
    })

    return { ...vendor, status: next, approvedByAdminId }
  })
}
