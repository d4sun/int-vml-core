import { safeRedirectPath } from "@/lib/auth/redirect"

import { REQUEST_PATH_HEADER } from "@/lib/auth/request-path-header"

// `proxy.ts` sets the header on every request to a role-restricted area. A
// layout cannot see which page was asked for, so the proxy hands it the real
// path and query; the layout uses it as the sign-in return path and still
// redirects before anything streams (a proper 307).

/**
 * The path to return to after signing in. It is only ever a same-site path
 * (`safeRedirectPath`), and `proxy.ts` overwrites the header on every request
 * to these areas, so a client-supplied value is never used.
 */
export async function requestReturnPath(fallback: string): Promise<string> {
  const { headers } = await import("next/headers")

  return safeRedirectPath((await headers()).get(REQUEST_PATH_HEADER), fallback)
}
