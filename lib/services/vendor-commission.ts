import type { PrismaClient } from "@prisma/client"
import { toNormalizedError } from "@/lib/actions/result"
import { requireAdmin, type SessionSource } from "@/lib/auth/guards"
import { NotFoundError } from "@/lib/errors"
import { audit } from "@/lib/services/audit"
import { setVendorCommissionSchema } from "@/lib/validation/vendor-commission"

export type VendorCommission = {
  id: string
  commissionBpsOverride: number | null
}

export type VendorCommissionDeps = {
  session?: SessionSource
  db?: Pick<PrismaClient, "$transaction">
  record?: typeof audit.record
}

/**
 * Sets or clears one vendor's commission override (admin only). It applies to
 * sales made from now on: a booking keeps the commission it was made with
 * (the snapshot on each booking item), so changing it never rewrites history.
 *
 * The change and its audit row are one transaction. Setting the value it
 * already has changes nothing and writes no audit row.
 */
export async function setVendorCommission(
  input: unknown,
  deps: VendorCommissionDeps = {}
): Promise<VendorCommission> {
  const actor = await requireAdmin(deps.session)

  const parsed = setVendorCommissionSchema.safeParse(input)

  if (!parsed.success) throw toNormalizedError(parsed.error)

  const { vendorId, commissionBps } = parsed.data
  const db = deps.db ?? (await import("@/lib/prisma")).prisma
  const record = deps.record ?? audit.record

  return db.$transaction(async (tx) => {
    const vendor = await tx.vendor.findUnique({
      where: { id: vendorId },
      select: { id: true, commissionBpsOverride: true },
    })

    if (!vendor) throw new NotFoundError("Vendor not found")

    if (vendor.commissionBpsOverride === commissionBps) {
      return { id: vendor.id, commissionBpsOverride: commissionBps }
    }

    await tx.vendor.update({
      where: { id: vendor.id },
      data: { commissionBpsOverride: commissionBps },
    })

    await record(tx, {
      actorId: actor.id,
      action: "vendor.commission_changed",
      entityType: "Vendor",
      entityId: vendor.id,
      meta: { from: vendor.commissionBpsOverride, to: commissionBps },
    })

    return { id: vendor.id, commissionBpsOverride: commissionBps }
  })
}
