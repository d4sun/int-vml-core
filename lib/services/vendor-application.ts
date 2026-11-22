import type { PrismaClient, VendorStatus } from "@prisma/client"
import { toNormalizedError } from "@/lib/actions/result"
import { requireUser, type SessionSource } from "@/lib/auth/guards"
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors"
import type { TransactionalEmailQueue } from "@/lib/email/transactional-queue"
import { audit } from "@/lib/services/audit"
import { notifyAdminsOfApplication } from "@/lib/services/vendor-notifications"
import { vendorApplicationSchema } from "@/lib/validation/vendor-application"
import { readAuditDetails } from "@/lib/vendors/presentation"
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
  /** Where the administrators' email jobs are enqueued (inside the transaction). */
  emailQueue?: TransactionalEmailQueue
  /** Public origin used in the email link; defaults to `BETTER_AUTH_URL`. */
  appUrl?: string
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
 *
 * Every administrator is emailed about the application by a job inserted in
 * the same transaction, so an application cannot be saved without its
 * notification, nor announce one that was rolled back. If that insert fails
 * the application fails and nothing is created.
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
  const emailQueue =
    deps.emailQueue ??
    (await (
      await import("@/lib/jobs/transactional")
    ).getTransactionalEmailQueue())
  const appUrl =
    deps.appUrl ?? (await import("@/lib/env")).getEnv().BETTER_AUTH_URL

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

    const auditId = await record(tx, {
      actorId: actor.id,
      action: "vendor.applied",
      entityType: "Vendor",
      entityId: vendor.id,
      meta: { name },
    })

    await notifyAdminsOfApplication(tx, emailQueue, {
      auditId,
      vendor: {
        id: vendor.id,
        name: vendor.name,
        ...(description ? { description } : {}),
      },
      applicant: { name: actor.name, email: actor.email },
      appUrl,
    })

    return vendor
  })
}

export type ApplicationSummary = {
  id: string
  name: string
  status: VendorStatus
  createdAt: Date
  /** The admin's reason, for a rejected or suspended vendor. */
  reason: string | null
}

export type ApplicationStatus = {
  /** The caller's account email, which the contact email defaults to. */
  email: string
  /** Administrators cannot apply, so the page says so instead of a form. */
  canApply: boolean
  application: ApplicationSummary | null
}

/**
 * Which of the caller's vendors the status page should show: one under review
 * wins (it is what is waiting on someone), otherwise the most recent.
 */
export function pickApplication<
  T extends { status: VendorStatus; createdAt: Date },
>(owned: T[]): T | null {
  const pending = owned.find((vendor) => vendor.status === "PENDING")

  if (pending) return pending

  return (
    [...owned].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    )[0] ?? null
  )
}

const DECISION_ACTION: Partial<Record<VendorStatus, string>> = {
  REJECTED: "vendor.rejected",
  SUSPENDED: "vendor.suspended",
}

/**
 * The caller's own application status, for the `/vendor/apply` page. Only
 * vendors the caller OWNS count (staff do not "apply"), and only the caller's
 * own are ever returned. The reason shown is the one recorded with the
 * decision that put the vendor in its current status.
 */
export async function getApplicationStatus(
  deps: {
    session?: SessionSource
    db?: Pick<PrismaClient, "vendor" | "auditLog">
  } = {}
): Promise<ApplicationStatus> {
  const actor = await requireUser(deps.session)
  const db = deps.db ?? (await import("@/lib/prisma")).prisma

  const owned = await db.vendor.findMany({
    where: { members: { some: { userId: actor.id, role: "OWNER" } } },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, name: true, status: true, createdAt: true },
  })

  const picked = pickApplication(owned)

  if (!picked) {
    return {
      email: actor.email,
      canApply: actor.platformRole !== "ADMIN",
      application: null,
    }
  }

  const decision = DECISION_ACTION[picked.status]
  const row = decision
    ? await db.auditLog.findFirst({
        where: {
          entityType: "Vendor",
          entityId: picked.id,
          action: decision,
        },
        orderBy: { at: "desc" },
        select: { meta: true },
      })
    : null

  return {
    email: actor.email,
    canApply: actor.platformRole !== "ADMIN",
    application: {
      ...picked,
      reason: readAuditDetails(row?.meta).reason ?? null,
    },
  }
}
