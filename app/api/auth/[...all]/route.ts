import { getAuth } from "@/lib/auth"

// Resolved per request so importing this module never needs auth env vars.
export function GET(request: Request) {
  return getAuth().handler(request)
}

export function POST(request: Request) {
  return getAuth().handler(request)
}
