import { notFound, redirect } from "next/navigation"
import { authorizeSurface, type Surface } from "@/lib/auth/surface"
import type { Actor } from "@/lib/auth/guards"
import { requestReturnPath } from "@/lib/auth/request-path"

/**
 * Acts on `authorizeSurface`: redirects a signed-out visitor to sign-in, shows
 * a 404 (no data, no hint) to anyone with the wrong role, and returns the actor
 * otherwise.
 *
 * Call it from the layout (omit `returnTo`: the proxy supplies the real path)
 * AND from every page in a restricted area (pass its own path). Next.js
 * renders a layout and its page in parallel, so a layout-only check does not
 * stop the page's output from being streamed to a visitor who is about to be
 * redirected. A page that calls this throws before it renders anything.
 */
export async function enforceSurface(
  surface: Surface,
  returnTo?: string
): Promise<Actor> {
  const decision = await authorizeSurface(
    surface,
    returnTo ?? (await requestReturnPath(`/${surface}`))
  )

  if (decision.action === "sign-in") redirect(decision.to)
  if (decision.action === "deny") notFound()

  return decision.actor
}
