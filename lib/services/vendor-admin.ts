import type { Prisma, PrismaClient, VendorStatus } from "@prisma/client"
import { toNormalizedError } from "@/lib/actions/result"
import { requireAdmin, type SessionSource } from "@/lib/auth/guards"
import { NotFoundError } from "@/lib/errors"
import { vendorIdSchema, vendorListSchema } from "@/lib/validation/vendor-admin"
import { VENDOR_STATUS_ORDER } from "@/lib/vendors/presentation"

/** The queue shows this many rows; `truncated` says when there are more. */
export const ADMIN_VENDOR_LIST_LIMIT = 100
const AUDIT_LIMIT = 50

export type AdminVendorRow = {
  id: string
  name: string
  slug: string
  status: VendorStatus
  contactEmail: string | null
  createdAt: Date
  owner: { name: string; email: string } | null
  listingCount: number
}

export type AdminVendorList = {
  vendors: AdminVendorRow[]
  counts: Record<VendorStatus, number>
  truncated: boolean
}

export type AdminVendorDetail = {
  id: string
  name: string
  slug: string
  description: string | null
  status: VendorStatus
  contactEmail: string | null
  stripeOnboardingComplete: boolean
  /** The vendor's own commission in basis points, or null to use each category's default. */
  commissionBpsOverride: number | null
  approvedByAdminId: string | null
  createdAt: Date
  members: Array<{ role: "OWNER" | "STAFF"; name: string; email: string }>
  listingCount: number
  audit: Array<{
    id: string
    action: string
    at: Date
    meta: Prisma.JsonValue
    actor: { name: string; email: string } | null
  }>
}

export type VendorAdminDeps = {
  session?: SessionSource
  db?: Pick<PrismaClient, "vendor" | "auditLog">
}

async function resolveDb(deps: VendorAdminDeps) {
  return deps.db ?? (await import("@/lib/prisma")).prisma
}

/**
 * The admin vendor queue, oldest first so nothing waits forever, with a count
 * per status for the filter tabs. Admin only; the check comes first.
 */
export async function listVendorsForAdmin(
  input: unknown,
  deps: VendorAdminDeps = {}
): Promise<AdminVendorList> {
  await requireAdmin(deps.session)

  const parsed = vendorListSchema.safeParse(input ?? {})

  if (!parsed.success) throw toNormalizedError(parsed.error)

  const db = await resolveDb(deps)

  const [rows, grouped] = await Promise.all([
    db.vendor.findMany({
      where: parsed.data.status ? { status: parsed.data.status } : {},
      orderBy: { createdAt: "asc" },
      take: ADMIN_VENDOR_LIST_LIMIT + 1,
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        contactEmail: true,
        createdAt: true,
        members: {
          where: { role: "OWNER" },
          take: 1,
          select: { user: { select: { name: true, email: true } } },
        },
        _count: { select: { listings: true } },
      },
    }),
    db.vendor.groupBy({ by: ["status"], _count: { _all: true } }),
  ])

  const counts = Object.fromEntries(
    VENDOR_STATUS_ORDER.map((status) => [status, 0])
  ) as Record<VendorStatus, number>

  for (const group of grouped) counts[group.status] = group._count._all

  return {
    vendors: rows.slice(0, ADMIN_VENDOR_LIST_LIMIT).map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      status: row.status,
      contactEmail: row.contactEmail,
      createdAt: row.createdAt,
      owner: row.members[0]?.user ?? null,
      listingCount: row._count.listings,
    })),
    counts,
    truncated: rows.length > ADMIN_VENDOR_LIST_LIMIT,
  }
}

/** One vendor with its team, listing count and recent audit history. */
export async function getVendorForAdmin(
  id: unknown,
  deps: VendorAdminDeps = {}
): Promise<AdminVendorDetail> {
  await requireAdmin(deps.session)

  const parsed = vendorIdSchema.safeParse(id)

  if (!parsed.success) throw toNormalizedError(parsed.error)

  const db = await resolveDb(deps)

  const vendor = await db.vendor.findUnique({
    where: { id: parsed.data },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      status: true,
      contactEmail: true,
      stripeOnboardingComplete: true,
      commissionBpsOverride: true,
      approvedByAdminId: true,
      createdAt: true,
      members: {
        orderBy: { createdAt: "asc" },
        select: { role: true, user: { select: { name: true, email: true } } },
      },
      _count: { select: { listings: true } },
    },
  })

  if (!vendor) throw new NotFoundError("Vendor not found")

  const audit = await db.auditLog.findMany({
    where: { entityType: "Vendor", entityId: vendor.id },
    orderBy: { at: "desc" },
    take: AUDIT_LIMIT,
    select: {
      id: true,
      action: true,
      at: true,
      meta: true,
      actor: { select: { name: true, email: true } },
    },
  })

  return {
    id: vendor.id,
    name: vendor.name,
    slug: vendor.slug,
    description: vendor.description,
    status: vendor.status,
    contactEmail: vendor.contactEmail,
    stripeOnboardingComplete: vendor.stripeOnboardingComplete,
    commissionBpsOverride: vendor.commissionBpsOverride,
    approvedByAdminId: vendor.approvedByAdminId,
    createdAt: vendor.createdAt,
    members: vendor.members.map((m) => ({
      role: m.role,
      name: m.user.name,
      email: m.user.email,
    })),
    listingCount: vendor._count.listings,
    audit,
  }
}
