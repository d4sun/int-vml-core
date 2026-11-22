import { NextResponse, type NextRequest } from "next/server"
import { REQUEST_PATH_HEADER } from "@/lib/auth/request-path-header"

// Tells layouts which page was requested (see `lib/auth/request-path.ts`).
// This is not an access check: authorisation happens in layouts, pages and
// services. The header is always overwritten here, never trusted from the
// client.
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers)
  headers.set(
    REQUEST_PATH_HEADER,
    request.nextUrl.pathname + request.nextUrl.search
  )

  return NextResponse.next({ request: { headers } })
}

export const config = {
  matcher: ["/admin/:path*", "/vendor/:path*"],
}
