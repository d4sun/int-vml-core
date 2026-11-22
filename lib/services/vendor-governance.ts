import type { PrismaClient, VendorStatus } from "@prisma/client"
import { toNormalizedError } from "@/lib/actions/result"
import { requireAdmin, type SessionSource } from "@/lib/auth/guards"
import { ConflictError, NotFoundError } from "@/lib/errors"
import type { TransactionalEmailQueue } from "@/lib/email/transactional-queue"
import { audit } from "@/lib/services/audit"
import { notifyVendorTransition } from "@/lib/services/vendor-notifications"
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
  /** Where the status email job is enqueued (inside the transaction). */
  emailQueue?: TransactionalEmailQueue
  /** Public origin used in email links; defaults to `BETTER_AUTH_URL`. */
  appUrl?: string
}

/**
 * Approves, rejects, suspends or reinstates a vendor (admin only).
 *
 * The admin check comes first and nothing about the input or the vendor is
 * revealed to anyone else. The status change and its audit row are one
 * transaction, and the update is guarded by the status that was read, so two
 * admins acting at once cannot both succeed: the loser gets a ConflictError
 * and no audit row.
 *
 * Approving also promotes the vendor's owner(s) from TOURIST to VENDOR, in the
 * same transaction; nothing else does.
 *
 * The vendor's owner is emailed about the change by a job inserted in the same
 * transaction, so a transition cannot be saved without its email, nor email a
 * change that was rolled back. If that insert fails the whole change fails.
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
  const emailQueue =
    deps.emailQueue ??
    (await (
      await import("@/lib/jobs/transactional")
    ).getTransactionalEmailQueue())
  const appUrl =
    deps.appUrl ?? (await import("@/lib/env")).getEnv().BETTER_AUTH_URL

  return db.$transaction(async (tx) => {
    const vendor = await tx.vendor.findUnique({
      where: { id: vendorId },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        contactEmail: true,
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

    // Approval is the only thing that makes an applicant a VENDOR. Only
    // tourists are promoted (never an admin), and who was promoted is recorded.
    const promoted: string[] = []

    if (action === "approve") {
      const owners = await tx.vendorMember.findMany({
        where: {
          vendorId,
          role: "OWNER",
          user: { platformRole: "TOURIST" },
        },
        select: { userId: true },
      })

      promoted.push(...owners.map((owner) => owner.userId))

      if (promoted.length > 0) {
        await tx.user.updateMany({
          where: { id: { in: promoted }, platformRole: "TOURIST" },
          data: { platformRole: "VENDOR" },
        })
      }
    }

    const auditId = await record(tx, {
      actorId: actor.id,
      action: auditActionFor(action),
      entityType: "Vendor",
      entityId: vendorId,
      meta: {
        from: vendor.status,
        to: next,
        ...(reason ? { reason } : {}),
        ...(promoted.length > 0 ? { promotedUserIds: promoted } : {}),
      },
    })

    await notifyVendorTransition(tx, emailQueue, {
      action,
      auditId,
      vendor: {
        id: vendor.id,
        name: vendor.name,
        contactEmail: vendor.contactEmail,
      },
      appUrl,
      ...(reason ? { reason } : {}),
    })

    return {
      id: vendor.id,
      name: vendor.name,
      slug: vendor.slug,
      status: next,
      approvedByAdminId,
    }
  })
}
