import { PlatformRole } from "@prisma/client"
import { UnauthenticatedError } from "@/lib/errors"

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
