import type { PlatformRole } from "@prisma/client"
import {
  requireRole,
  requestSessionSource,
  type Actor,
  type SessionSource,
} from "@/lib/auth/guards"
import { ForbiddenError, UnauthenticatedError } from "@/lib/errors"

export type Surface = "vendor" | "admin"

const SURFACE_ROLE: Record<Surface, PlatformRole> = {
  vendor: "VENDOR",
  admin: "ADMIN",
}

export type SurfaceDecision =
  | { action: "allow"; actor: Actor }
  | { action: "sign-in"; to: string }
  | { action: "deny" }

/**
 * The coarse gate for a role-restricted area, as a decision a layout acts on:
 * signed out → send to sign-in (and back afterwards), wrong role → deny with no
 * data and no hint. Anything unexpected (for example the session lookup
 * failing) propagates instead of being read as "allow".
 *
 * This is only the first gate. Next.js does not re-run a layout when moving
 * between its pages, so every service still re-checks (`requireRole`,
 * `requireVendorMember`).
 */
export async function authorizeSurface(
  surface: Surface,
  returnTo: string,
  session: SessionSource = requestSessionSource
): Promise<SurfaceDecision> {
  try {
    return {
      action: "allow",
      actor: await requireRole(SURFACE_ROLE[surface], session),
    }
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return {
        action: "sign-in",
        to: `/sign-in?next=${encodeURIComponent(returnTo)}`,
      }
    }

    if (error instanceof ForbiddenError) return { action: "deny" }

    throw error
  }
}
