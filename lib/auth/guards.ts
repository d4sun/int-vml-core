import {
  PlatformRole,
  type PrismaClient,
  type VendorRole,
} from "@prisma/client"
import { ForbiddenError, UnauthenticatedError } from "@/lib/errors"

/** The authenticated caller, as services see them. Never built from input. */
export type Actor = {
  id: string
  email: string
  name: string
  emailVerified: boolean
  platformRole: PlatformRole
}

type SessionUser = {
  id: string
  email: string
  name: string
  emailVerified: boolean
  platformRole?: string | null
}

/** Resolves the current session, or `null` when there is none. */
export type SessionSource = () => Promise<{ user: SessionUser } | null>

/**
 * Reads the session from the current Next.js request (cookies via
 * `next/headers`). Imports are lazy so that unit tests, which pass their own
 * `SessionSource`, never load Next or the database.
 */
export const requestSessionSource: SessionSource = async () => {
  const [{ headers }, { getAuth }] = await Promise.all([
    import("next/headers"),
    import("@/lib/auth"),
  ])

  // `headers()` first: it opts the caller into dynamic rendering before
  // anything that could throw at build time (a missing auth secret) runs.
  const requestHeaders = await headers()

  return getAuth().api.getSession({ headers: requestHeaders })
}

const KNOWN_ROLES = new Set<string>(Object.values(PlatformRole))

/**
 * Every service entrypoint starts here (CR-1). UI hiding is never a control.
 * An unknown role value is treated as the least privileged one rather than
 * trusted.
 */
export async function requireUser(
  session: SessionSource = requestSessionSource
): Promise<Actor> {
  const current = await session()

  if (!current) throw new UnauthenticatedError()

  const { user } = current

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerified: user.emailVerified,
    platformRole:
      user.platformRole && KNOWN_ROLES.has(user.platformRole)
        ? (user.platformRole as PlatformRole)
        : PlatformRole.TOURIST,
  }
}

const toRoles = (roles: PlatformRole | readonly PlatformRole[]) =>
  typeof roles === "string" ? [roles] : roles

/**
 * Requires one of the given platform roles. Unauthenticated callers get a 401,
 * authenticated callers with the wrong role a 403. Roles are matched exactly:
 * ADMIN does not implicitly satisfy VENDOR.
 *
 * This is the coarse gate for a surface; services still re-check their own
 * rules (for example `requireVendorMember`).
 */
export async function requireRole(
  roles: PlatformRole | readonly PlatformRole[],
  session: SessionSource = requestSessionSource
): Promise<Actor> {
  const actor = await requireUser(session)

  if (!toRoles(roles).includes(actor.platformRole)) throw new ForbiddenError()

  return actor
}

export function requireAdmin(
  session: SessionSource = requestSessionSource
): Promise<Actor> {
  return requireRole(PlatformRole.ADMIN, session)
}

/** Looks up a user's membership of a vendor, or `null` when there is none. */
export type MembershipStore = {
  findMembership(
    userId: string,
    vendorId: string
  ): Promise<{ role: VendorRole } | null>
}

export function prismaMembershipStore(
  prisma: Pick<PrismaClient, "vendorMember">
): MembershipStore {
  return {
    findMembership: (userId, vendorId) =>
      prisma.vendorMember.findUnique({
        where: { userId_vendorId: { userId, vendorId } },
        select: { role: true },
      }),
  }
}

/** The caller, plus the vendor they were proven to belong to (CR-2). */
export type VendorActor = Actor & { vendorId: string; vendorRole: VendorRole }

export type VendorGuardDeps = {
  session?: SessionSource
  memberships?: MembershipStore
}

/**
 * Requires the caller to be a member of `vendorId`, optionally with one of the
 * given vendor roles. The user id comes from the session and the vendor id
 * from the service, never from a client-supplied `vendorId` on its own: a
 * membership row is what grants access.
 *
 * "Not a member", "wrong role" and "no such vendor" are all the same
 * ForbiddenError, so this cannot be used to discover which vendors exist.
 * Vendor status (approved, onboarded) is a separate rule, enforced where money
 * or publishing is involved.
 */
export async function requireVendorMember(
  vendorId: string,
  roles?: readonly VendorRole[],
  deps: VendorGuardDeps = {}
): Promise<VendorActor> {
  const actor = await requireUser(deps.session)

  if (typeof vendorId !== "string" || vendorId.length === 0) {
    throw new ForbiddenError()
  }

  const memberships =
    deps.memberships ??
    prismaMembershipStore((await import("@/lib/prisma")).prisma)

  const membership = await memberships.findMembership(actor.id, vendorId)

  if (!membership || (roles && !roles.includes(membership.role))) {
    throw new ForbiddenError()
  }

  return { ...actor, vendorId, vendorRole: membership.role }
}
